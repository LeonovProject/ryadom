#!/usr/bin/env python3
"""Validate the shared OpenAPI contract and its executable sample payloads.

Uses the separate tools in requirements-contracts.txt. Does not call a server,
create database data, or evaluate application authorization/business logic.
"""

import json
from pathlib import Path
import re

try:
    import yaml
    from jsonschema import ValidationError, validators
    from openapi_schema_validator import OAS30Validator, oas30_format_checker
    from openapi_spec_validator import validate
except ImportError as exc:
    raise SystemExit(
        "Contract tools are missing; install scripts/requirements-contracts.txt "
        "in a separate virtual environment. See packages/contracts/README.md."
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "packages" / "contracts"
METHODS = {"get", "post", "put", "delete", "patch", "head", "options"}


class UniqueKeyLoader(yaml.SafeLoader):
    """Do not silently overwrite a duplicated YAML key."""


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utf8_bytes(validator, limit, instance, schema):
    if isinstance(instance, str) and len(instance.encode("utf-8")) > limit:
        yield ValidationError(f"UTF-8 value exceeds {limit} bytes")


def check_sample_identities(value, label):
    """A sample list cannot contain two states of the same resource ID."""
    if isinstance(value, dict):
        if {"account", "status", "revision", "blockedAt", "blockedByAccountId"} <= value.keys():
            blocked = value["status"] == "BLOCKED"
            require(value["account"]["isBlocked"] == blocked,
                    f"Account status/public flag drift: {label}")
            require((value["blockedAt"] is not None) == blocked
                    and (value["blockedByAccountId"] is not None) == blocked,
                    f"Account status/review metadata drift: {label}")
            require(value["systemRole"] != "ADMIN" or not blocked,
                    f"Blocked administrative account in sample: {label}")
        for key, child in value.items():
            check_sample_identities(child, f"{label}/{key}")
    elif isinstance(value, list):
        for path in [("id",), ("participation", "id"), ("event", "id"), ("account", "id")]:
            identities = []
            for item in value:
                current = item
                for key in path:
                    current = current.get(key) if isinstance(current, dict) else None
                if isinstance(current, str):
                    identities.append(current)
            require(len(identities) == len(set(identities)),
                    f"Duplicate {'/'.join(path)} in sample list: {label}")
        for index, child in enumerate(value):
            check_sample_identities(child, f"{label}/{index}")


ContractValidator = validators.extend(
    OAS30Validator, {"x-max-utf8-bytes": utf8_bytes}
)


def main():
    spec = yaml.load((BASE / "openapi.yaml").read_text(), Loader=UniqueKeyLoader)
    require(spec["openapi"] == "3.0.3", "Unexpected OpenAPI version")
    validate(spec)
    tooling = json.loads((BASE / "tooling.json").read_text())
    require(spec["info"]["version"] == tooling["contractVersion"], "Contract version drift")

    def resolve(value):
        while "$ref" in value:
            pointer = value["$ref"]
            require(pointer.startswith("#/"), f"Non-local reference: {pointer}")
            value = spec
            for part in pointer[2:].split("/"):
                value = value[part.replace("~1", "/").replace("~0", "~")]
        return value

    def check_value(schema, value):
        ContractValidator(
            {"allOf": [schema], "components": spec["components"]},
            format_checker=oas30_format_checker,
        ).validate(value)

    operations = {}
    inline_examples = []
    for path, path_item in spec["paths"].items():
        for method, operation in path_item.items():
            if method not in METHODS:
                continue
            name = operation["operationId"]
            require(name not in operations, f"Duplicate operationId: {name}")
            operations[name] = (path, method, operation)
            parameters = [resolve(p) for p in operation.get("parameters", [])]
            actual = {p["name"] for p in parameters if p["in"] == "path"}
            require(actual == set(re.findall(r"{([^}]+)}", path)), name)
            access = operation["x-access"]
            if access in {"session", "event-owner", "organization-owner", "admin"}:
                require(operation["security"] == [{"sessionCookie": []}], name)
                require("401" in operation["responses"], name)
            if access in {"session", "optional-session", "event-owner", "organization-owner", "admin"}:
                require("ACCOUNT_BLOCKED" in operation["x-error-codes"].get("403", []),
                        f"Missing blocked-account response: {name}")
            if path.startswith("/admin/"):
                require(access == "admin", name)
                require("403" in operation["responses"], name)
            if method != "get":
                require(operation.get("x-requires-origin") is True, name)
            for status, response in operation["responses"].items():
                response = resolve(response)
                if status == "204":
                    require("content" not in response, name)
                for media in response.get("content", {}).values():
                    for example_name, example in media.get("examples", {}).items():
                        check_value(media["schema"], example["value"])
                        check_sample_identities(example["value"], f"{name}/{example_name}")
                        inline_examples.append((example_name, name, status, example["value"]))

    cases = json.loads((BASE / "examples/http-cases.json").read_text())
    seen_names, covered = set(), set()
    for case in cases:
        name = case["name"]
        require(name not in seen_names, f"Duplicate example: {name}")
        seen_names.add(name)
        path, method, operation = operations[case["operationId"]]
        status = str(case["responseStatus"])
        require(status in operation["responses"], name)
        if status.startswith("2"):
            covered.add((case["operationId"], status))
        parameters = [resolve(p) for p in operation.get("parameters", [])]
        for location, values in [("path", case["pathParameters"]), ("query", case["query"])]:
            allowed = {p["name"]: p for p in parameters if p["in"] == location}
            require(set(values) <= set(allowed), name)
            for key, value in values.items():
                check_value(allowed[key]["schema"], value)
            for key, parameter in allowed.items():
                if parameter.get("required"):
                    require(key in values, name)
        if "requestBody" in operation:
            request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
            if "requestBodyRecipe" in case:
                require("requestBody" not in case, name)
                size = case["requestBodyRecipe"]["svgUtf8Bytes"]
                prefix, suffix = '<svg xmlns="http://www.w3.org/2000/svg"><!--', '--></svg>'
                value = prefix + " " * (size - len(prefix) - len(suffix)) + suffix
                require(case["responseStatus"] == 413, name)
                try:
                    check_value(request_schema, {**case["requestBodyRecipe"].get("fields", {}), "svg": value})
                except ValidationError:
                    pass
                else:
                    raise ValueError(f"Oversized sample request was accepted: {name}")
            else:
                require("requestBody" in case, f"Missing sample request: {name}")
                check_value(request_schema, case["requestBody"])
        else:
            require("requestBody" not in case, name)
        response = resolve(operation["responses"][status])
        if status == "204":
            require("responseBody" not in case, name)
        else:
            require("responseBody" in case, name)
            media = next(iter(response["content"].values()))
            check_value(media["schema"], case["responseBody"])
            check_sample_identities(case["responseBody"], name)
        if status == "429":
            retry_after = case["responseHeaders"].get("Retry-After", "")
            require(str(retry_after).isdigit() and int(retry_after) >= 1,
                    f"Missing/invalid Retry-After: {name}")
        if status.startswith(("4", "5")):
            error = case["responseBody"]["error"]
            require(error["code"] in operation["x-error-codes"][status], name)
            require(error["requestId"] == case["responseHeaders"]["X-Request-ID"], name)

    by_name = {case["name"]: case for case in cases}
    for example_name, operation_id, status, value in inline_examples:
        if example_name in by_name:
            case = by_name[example_name]
            require(case["operationId"] == operation_id
                    and str(case["responseStatus"]) == status
                    and case.get("responseBody") == value,
                    f"OpenAPI/HTTP example drift: {example_name}")

    for name, (_, _, operation) in operations.items():
        for status in operation["responses"]:
            if status.startswith("2"):
                require((name, status) in covered, f"Missing success example: {name} {status}")

    require({"login", "register", "adminListAccounts", "adminGetAccount", "adminSetAccountStatus"}
            <= operations.keys(), "Missing authentication/moderation operation")
    require(not {"demoLogin", "demoRegister", "listDemoProfiles"} & operations.keys(),
            "Obsolete demo authentication is still exposed")
    schemas = spec["components"]["schemas"]
    require(set(schemas["RegisterInput"]["required"])
            == {"email", "password", "displayName", "presetId"}, "Registration fields drift")
    require(schemas["RegisterInput"]["properties"]["password"]["minLength"] == 15
            and schemas["RegisterInput"]["properties"]["password"]["maxLength"] == 128,
            "Registration password bounds drift")
    require("email" in schemas["Me"]["required"], "Missing private account email")
    require(set(schemas["PublicAccount"]["properties"])
            == {"id", "displayName", "avatarUrl", "isBlocked"}, "Public account field drift")
    require(set(schemas["AccountStatusInput"]["required"])
            == {"status", "expectedRevision"}, "Account decision concurrency drift")
    registration = {"email": "EXAMPLE@example.test", "displayName": "Пользователь",
                    "presetId": "ryadom-companion"}
    for password in ["я" * 15, "я" * 128, " " + "x" * 13 + " "]:
        check_value(schemas["RegisterInput"], {**registration, "password": password})

    presets = json.loads((BASE / "avatar-presets.json").read_text())
    check_value(spec["components"]["schemas"]["AvatarPresetList"], presets)
    preset_ids = set()
    preset_files = set()
    for preset in presets["items"]:
        preset_id = preset["id"]
        require(preset_id not in preset_ids, "Duplicate avatar preset ID")
        preset_ids.add(preset_id)
        require(preset["imageUrl"] == f"/assets/avatars/presets/{preset_id}.svg", "Preset URL/ID mismatch")
        source = BASE / "avatar-presets" / f"{preset_id}.svg"
        require(source.is_file() and not source.is_symlink(), f"Missing regular preset file: {preset_id}")
        raw = source.read_bytes()
        raw.decode("utf-8")
        require(0 < len(raw) <= 131072, f"Invalid preset SVG byte size: {preset_id}")
        preset_files.add(source.name)
    require(preset_files == {p.name for p in (BASE / "avatar-presets").glob("*.svg")},
            "Preset SVG sources/manifest differ")

    negative = json.loads((BASE / "examples/invalid-payloads.json").read_text())
    for case in negative:
        schema = spec["components"]["schemas"][case["schema"]]
        try:
            check_value(schema, case["value"])
        except ValidationError:
            pass
        else:
            raise ValueError(f"Invalid sample was accepted: {case['name']}")

    svg_schema = spec["components"]["schemas"]["CoverInput"]
    require(svg_schema["properties"]["svg"]["x-max-utf8-bytes"] == 131072, "SVG limit drift")
    cover_body_limit = operations["setEventCover"][2]["x-max-body-bytes"]
    require(cover_body_limit == 1048576, "Cover JSON body limit drift")
    # Worst-case JSON escaping budget only; this is not a valid SVG/XML sample.
    escaped_body = json.dumps({"svg": "\x00" * 131072}).encode("utf-8")
    require(len(escaped_body) <= cover_body_limit, "Cover JSON budget is too small")
    # These isolate the documented byte rule; they do not validate SVG/XML safety.
    for value in ["a" * 131072, "я" * 65536]:
        check_value(svg_schema, {"svg": value})
    for value in ["a" * 131073, "я" * 65537]:
        try:
            check_value(svg_schema, {"svg": value})
        except ValidationError:
            pass
        else:
            raise ValueError("Oversized SVG string was accepted by the byte rule")

    avatar_schema = spec["components"]["schemas"]["AvatarUploadInput"]
    require(avatar_schema["properties"]["svg"]["x-max-utf8-bytes"] == 131072, "Avatar SVG limit drift")
    require(operations["uploadAvatar"][2]["x-max-body-bytes"] == 1048576, "Avatar JSON limit drift")
    avatar_fields = {"expectedRevision": 0}
    require(len(json.dumps({**avatar_fields, "svg": "\x00" * 131072}).encode("utf-8")) <= 1048576,
            "Avatar JSON escaping budget is too small")
    for value in ["a" * 131072, "я" * 65536]:
        check_value(avatar_schema, {**avatar_fields, "svg": value})
    for value in ["a" * 131073, "я" * 65537]:
        try:
            check_value(avatar_schema, {**avatar_fields, "svg": value})
        except ValidationError:
            pass
        else:
            raise ValueError("Oversized avatar SVG was accepted by the byte rule")

    print(
        f"PASS: OpenAPI 3.0.3, {len(operations)} operations, "
        f"{len(spec['components']['schemas'])} schemas, {len(cases)} HTTP examples, "
        f"{len(negative)} rejected payloads, SVG byte boundaries, "
        f"preset manifest ({len(preset_ids)} items), unique sample IDs, "
        f"matching named OpenAPI/HTTP examples, authentication/blocking contract. No API executed."
    )


if __name__ == "__main__":
    main()
