#!/usr/bin/env python3
"""Emit the reviewed BE-03 integration patch only for unchanged shared sources.

Does not modify shared files; COORDINATOR reviews and applies the emitted patch.
The patch is encoded as string literals to preserve its exact context whitespace.
"""
import argparse
import hashlib
from pathlib import Path

PREIMAGES = {'apps/api/cmd/api/main.go': 'e341f753aa9d155d4d60530515e6dcda621cd808f2ee3e62e32a20b175668838', 'apps/api/internal/transport/httpapi/validation.go': 'ce2245655807ba17afeeabeebd459cddafe48049f1fe03bc840f3bc0d1c7e449'}
PATCH = (
    "--- a/apps/api/cmd/api/main.go\n"
    "+++ b/apps/api/cmd/api/main.go\n"
    "@@ -11,6 +11,8 @@\n"
    " \t\"time\"\n"
    " \n"
    " \t\"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts\"\n"
    "+\t\"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes\"\n"
    "+\t\"github.com/LeonovProject/ryadom/apps/api/internal/modules/events\"\n"
    " \t\"github.com/LeonovProject/ryadom/apps/api/internal/modules/auth\"\n"
    " \t\"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn\"\n"
    " \t\"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets\"\n"
    "@@ -67,6 +69,16 @@\n"
    " \tif err := authService.Register(handler); err != nil {\n"
    " \t\treturn err\n"
    " \t}\n"
    "+\teventService, err := events.New(accountService, cfg.JWTSecret, time.Now)\n"
    "+\tif err != nil {\n"
    "+\t\treturn err\n"
    "+\t}\n"
    "+\tif err := eventService.Register(handler); err != nil {\n"
    "+\t\treturn err\n"
    "+\t}\n"
    "+\tif err := activitytypes.Register(handler); err != nil {\n"
    "+\t\treturn err\n"
    "+\t}\n"
    " \tserver := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}\n"
    " \tstopped := make(chan error, 1)\n"
    " \tgo func() { stopped <- server.ListenAndServe() }()\n"
    "--- a/apps/api/internal/transport/httpapi/validation.go\n"
    "+++ b/apps/api/internal/transport/httpapi/validation.go\n"
    "@@ -43,6 +43,16 @@\n"
    " \tfor name, values := range query {\n"
    " \t\tif !allowed[name] || len(values) != 1 {\n"
    " \t\t\treturn invalidRequest()\n"
    "+\t\t}\n"
    "+\t}\n"
    "+\tif values, present := query[\"cursor\"]; present && len(values) == 1 && (values[0] == \"\" || len(values[0]) > 2048) {\n"
    "+\t\treturn fault.New(400, openapi.ErrorCodeINVALIDCURSOR, \"Некорректный курсор. Начните с первой страницы.\")\n"
    "+\t}\n"
    "+\t// The contract explicitly defines empty search/city as an absent filter.\n"
    "+\t// Normalize only the validator's query; the handler keeps the original request.\n"
    "+\tfor _, name := range []string{\"q\", \"city\"} {\n"
    "+\t\tif values := query[name]; len(values) == 1 && values[0] == \"\" {\n"
    "+\t\t\tquery.Del(name)\n"
    " \t\t}\n"
    " \t}\n"
    " \tinput := &openapi3filter.RequestValidationInput{Request: r, PathParams: params, QueryParams: query, Route: &routers.Route{Spec: s.spec, Path: op.path, PathItem: op.item, Method: op.method, Operation: op.spec}, Options: &openapi3filter.Options{ExcludeRequestBody: true, SkipSettingDefaults: true, AuthenticationFunc: openapi3filter.NoopAuthenticationFunc}}\n"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[5])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    for name, expected in PREIMAGES.items():
        if hashlib.sha256((args.root / name).read_bytes()).hexdigest() != expected:
            parser.error(f'Shared source changed: {name}; rebase/review the patch before integration.')
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        output.write(PATCH)
    print(f'Integration patch written: {args.output}')


if __name__ == '__main__':
    main()
