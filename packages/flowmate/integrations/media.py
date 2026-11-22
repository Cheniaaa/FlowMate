"""MCP 媒体在接收边界解码一次；原始字节不进入持久工具回执。"""

import base64
import binascii
import ctypes
from ctypes import wintypes

from flowmate.contracts.base import DomainError
from flowmate.images import image_size


def image_dimensions(data, media_type, *, max_bytes, max_pixels):
    """复用 Windows 自带 GDI+；先约束尺寸，再强制完整解码。"""
    if len(data) > max_bytes:
        raise DomainError("mcp_image_too_large", "图片字节超过接收上限")
    actual = ("image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else
        "image/jpeg" if data.startswith(b"\xff\xd8\xff") else None)
    if actual is None or actual != media_type:
        raise DomainError("mcp_image_type_invalid", "图片声明类型与实际内容不一致，仅支持 PNG/JPEG")
    # GDI+ 容许不完整的 PNG 尾部；进入解码器前拒绝截断容器。
    if actual == "image/png" and not data.endswith(b"\0\0\0\0IEND\xaeB`\x82"):
        raise DomainError("mcp_image_invalid", "PNG 图片内容不完整")
    if actual == "image/jpeg" and not data.rstrip(b"\0\r\n ").endswith(b"\xff\xd9"):
        raise DomainError("mcp_image_invalid", "JPEG 图片内容不完整")
    width, height = image_size(data)
    if not width or not height or width * height > max_pixels:
        raise DomainError("mcp_image_too_large", "图片像素超过接收上限")

    class Startup(ctypes.Structure):
        _fields_ = [("version", wintypes.UINT), ("callback", ctypes.c_void_p),
            ("suppress_thread", wintypes.BOOL), ("suppress_codecs", wintypes.BOOL)]

    gdip = ctypes.WinDLL("gdiplus")
    stream_factory = ctypes.WinDLL("shlwapi").SHCreateMemStream
    stream_factory.argtypes = [ctypes.c_void_p, wintypes.UINT]
    stream_factory.restype = ctypes.c_void_p
    stream = stream_factory(data, len(data))
    if not stream:
        raise DomainError("mcp_image_invalid", "无法读取图片内容")
    token, bitmap, rendered = ctypes.c_size_t(), ctypes.c_void_p(), ctypes.c_void_p()

    def check(status):
        if status:
            raise DomainError("mcp_image_invalid", "图片无法完整解码")

    started = False
    try:
        check(gdip.GdiplusStartup(ctypes.byref(token), ctypes.byref(Startup(1)), None))
        started = True
        check(gdip.GdipCreateBitmapFromStream(ctypes.c_void_p(stream), ctypes.byref(bitmap)))
        width, height = wintypes.UINT(), wintypes.UINT()
        check(gdip.GdipGetImageWidth(bitmap, ctypes.byref(width)))
        check(gdip.GdipGetImageHeight(bitmap, ctypes.byref(height)))
        if not width.value or not height.value or width.value * height.value > max_pixels:
            raise DomainError("mcp_image_too_large", "图片像素超过接收上限")
        check(gdip.GdipImageForceValidation(bitmap))
        check(gdip.GdipCreateHBITMAPFromBitmap(bitmap, ctypes.byref(rendered), 0))
        return width.value, height.value
    finally:
        if rendered.value:
            delete = ctypes.WinDLL("gdi32").DeleteObject
            delete.argtypes = [ctypes.c_void_p]
            delete(rendered)
        if bitmap.value:
            gdip.GdipDisposeImage(bitmap)
        if started:
            gdip.GdiplusShutdown(token)
        vtable = ctypes.cast(stream, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        ctypes.WINFUNCTYPE(wintypes.ULONG, ctypes.c_void_p)(vtable[2])(stream)


def normalize_content(items, *, max_bytes, max_pixels):
    from mcp import types

    content = []
    for index, item in enumerate(items):
        if isinstance(item, types.TextContent):
            content.append({"type": "text", "text": item.text})
        elif isinstance(item, types.ImageContent):
            try:
                if len(item.data) > 4 * ((max_bytes + 2) // 3):
                    raise DomainError("mcp_image_too_large", "图片字节超过接收上限")
                try:
                    data = base64.b64decode(item.data, validate=True)
                except (ValueError, binascii.Error):
                    raise DomainError("mcp_image_invalid", "图片 Base64 内容无效") from None
                width, height = image_dimensions(data, item.mime_type,
                    max_bytes=max_bytes, max_pixels=max_pixels)
                content.append({"type": "image", "data": data, "media_type": item.mime_type,
                    "width": width, "height": height})
            except DomainError as error:
                content.append({"type": "notice", "text": f"第 {index + 1} 项：{error.safe_message}"})
        elif isinstance(item, types.EmbeddedResource) and isinstance(item.resource, types.TextResourceContents):
            content.append({"type": "text", "text": item.resource.text})
        elif isinstance(item, types.ResourceLink):
            content.append({"type": "resource_link", "name": item.name,
                "uri": str(item.uri), "media_type": item.mime_type})
        else:
            content.append({"type": "notice", "text": f"第 {index + 1} 项：暂不支持 {item.type} 内容"})
    return tuple(content)
