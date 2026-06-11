#!/usr/bin/env python3
"""Set and verify Beat.app as the default macOS handler for .beat projects."""

from __future__ import annotations

import ctypes
import sys


CONTENT_TYPE = "com.beat.project"
FILENAME_EXTENSION = "beat"
DEFAULT_BUNDLE_ID = "com.beat.app"
K_LS_ROLES_ALL = 0xFFFFFFFF


def _cfstring(core_foundation: ctypes.CDLL, value: str) -> ctypes.c_void_p:
    create = core_foundation.CFStringCreateWithCString
    create.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    create.restype = ctypes.c_void_p
    return create(None, value.encode("utf-8"), 0x08000100)


def _cfstring_to_py(core_foundation: ctypes.CDLL, value: ctypes.c_void_p) -> str:
    if not value:
        return ""

    get_c_string_ptr = core_foundation.CFStringGetCStringPtr
    get_c_string_ptr.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    get_c_string_ptr.restype = ctypes.c_char_p
    ptr = get_c_string_ptr(value, 0x08000100)
    if ptr:
        return ptr.decode("utf-8")

    get_length = core_foundation.CFStringGetLength
    get_length.argtypes = [ctypes.c_void_p]
    get_length.restype = ctypes.c_long
    max_size = (get_length(value) * 4) + 1
    buffer = ctypes.create_string_buffer(max_size)

    get_c_string = core_foundation.CFStringGetCString
    get_c_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
    get_c_string.restype = ctypes.c_bool
    if get_c_string(value, buffer, max_size, 0x08000100):
        return buffer.value.decode("utf-8")
    return ""


def _release(core_foundation: ctypes.CDLL, value: ctypes.c_void_p) -> None:
    if value:
        release = core_foundation.CFRelease
        release.argtypes = [ctypes.c_void_p]
        release(value)


def _preferred_content_type_for_extension(core_services: ctypes.CDLL, core_foundation: ctypes.CDLL, extension: str) -> str:
    create_identifier = core_services.UTTypeCreatePreferredIdentifierForTag
    create_identifier.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    create_identifier.restype = ctypes.c_void_p

    filename_extension = _cfstring(core_foundation, "public.filename-extension")
    extension_value = _cfstring(core_foundation, extension)
    content_type = create_identifier(filename_extension, extension_value, None)
    resolved = _cfstring_to_py(core_foundation, content_type)

    _release(core_foundation, content_type)
    _release(core_foundation, filename_extension)
    _release(core_foundation, extension_value)
    return resolved


def main() -> int:
    verify_only = "--verify-only" in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != "--verify-only"]
    bundle_id = args[0] if len(args) > 0 else DEFAULT_BUNDLE_ID
    core_services = ctypes.CDLL("/System/Library/Frameworks/CoreServices.framework/CoreServices")
    core_foundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    resolved_extension_type = _preferred_content_type_for_extension(
        core_services,
        core_foundation,
        FILENAME_EXTENSION,
    )

    content_type = _cfstring(core_foundation, CONTENT_TYPE)
    handler = _cfstring(core_foundation, bundle_id)

    if not verify_only:
        set_handler = core_services.LSSetDefaultRoleHandlerForContentType
        set_handler.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
        set_handler.restype = ctypes.c_int32
        status = set_handler(content_type, K_LS_ROLES_ALL, handler)
        if status != 0:
            print(f"Failed to set default handler for {CONTENT_TYPE}: OSStatus {status}", file=sys.stderr)
            if resolved_extension_type and resolved_extension_type != CONTENT_TYPE:
                print(
                    f".{FILENAME_EXTENSION} currently resolves to {resolved_extension_type}; "
                    f"the Beat app bundle has not registered {CONTENT_TYPE} with LaunchServices.",
                    file=sys.stderr,
                )
            _release(core_foundation, content_type)
            _release(core_foundation, handler)
            return 1

    copy_handler = core_services.LSCopyDefaultRoleHandlerForContentType
    copy_handler.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    copy_handler.restype = ctypes.c_void_p
    current = copy_handler(content_type, K_LS_ROLES_ALL)
    current_bundle_id = _cfstring_to_py(core_foundation, current)

    _release(core_foundation, current)
    _release(core_foundation, content_type)
    _release(core_foundation, handler)

    if current_bundle_id != bundle_id:
        print(
            f"Default handler mismatch for {CONTENT_TYPE}: expected {bundle_id}, got {current_bundle_id or '<none>'}",
            file=sys.stderr,
        )
        if resolved_extension_type and resolved_extension_type != CONTENT_TYPE:
            print(
                f".{FILENAME_EXTENSION} currently resolves to {resolved_extension_type}; "
                f"expected {CONTENT_TYPE}.",
                file=sys.stderr,
            )
        return 1

    print(f"{CONTENT_TYPE} -> {current_bundle_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
