# QR-01

`createInvitationQr(url: string): Promise<string>` from `shared/qr` returns a PNG
data URL or rejects. Local `qrcode@1.5.4`, MIT (license in installed package);
`@types/qrcode@1.5.6` is build-time only. M correction, 4-module quiet zone,
512×512, black on white. No external service, CDN or network request.
Empty/invalid/non-HTTP URLs and credentials reject. Event UUID, canonical origin,
query/hash removal and allowed publication are the caller's responsibility.
The module never reads the browser URL or chooses a meeting.
