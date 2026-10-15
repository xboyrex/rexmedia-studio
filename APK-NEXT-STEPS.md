# Android APK — next phase

RexMedia Studio is currently delivered as a responsive website/PWA-ready package, not as an APK. The `manifest.webmanifest` and 192/512 pixel app icons prepare the branding for the later Android package step.

Recommended order:

1. Deploy the site to its final HTTPS domain.
2. Test YouTube/Instagram extraction and direct-media downloads on Android Chrome.
3. Decide between a Trusted Web Activity (best fit for a fully hosted website) and an Android WebView wrapper (more control over file downloads, but more native code to maintain).
4. If using a Trusted Web Activity, configure Android package ID, signing, app icons, and `/.well-known/assetlinks.json` for the final domain.
5. Build and test the APK on an Android device. Do not package production credentials; none are needed by this frontend.

The exact app ID, signing key and final domain are not chosen in this package, so an APK cannot be correctly signed or verified until those decisions are made.
