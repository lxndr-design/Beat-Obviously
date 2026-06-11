#!/usr/bin/env bash
set -euo pipefail

plist="${1:-}"
if [[ -z "$plist" || ! -f "$plist" ]]; then
  echo "usage: $0 /path/to/Beat.app/Contents/Info.plist" >&2
  exit 2
fi

buddy="/usr/libexec/PlistBuddy"

"$buddy" -c "Delete :CFBundleDocumentTypes" "$plist" >/dev/null 2>&1 || true
"$buddy" -c "Add :CFBundleDocumentTypes array" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0 dict" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Beat Project" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Editor" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeIconFile string Icon.icns" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string beat" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeMIMETypes array" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:CFBundleTypeMIMETypes:0 string application/x-beat-project" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$plist"
"$buddy" -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string com.beat.project" "$plist"

"$buddy" -c "Delete :UTExportedTypeDeclarations" "$plist" >/dev/null 2>&1 || true
"$buddy" -c "Add :UTExportedTypeDeclarations array" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0 dict" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string com.beat.project" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeDescription string Beat Project" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeIconFile string Icon.icns" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string public.data" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:1 string public.json" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string beat" "$plist"
"$buddy" -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type string application/x-beat-project" "$plist"
