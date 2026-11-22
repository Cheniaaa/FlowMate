"""PNG/JPEG 容器尺寸；接收边界仍须用系统解码器验证像素内容。"""

import struct

from flowmate.contracts.base import DomainError


def image_size(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24 and data[12:16] == b"IHDR":
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 4 < len(data):
            if data[offset] != 255:
                break
            while offset < len(data) and data[offset] == 255:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            size = int.from_bytes(data[offset:offset + 2], "big")
            if size < 2 or offset + size > len(data):
                break
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                if size >= 7:
                    height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                    return width, height
                break
            offset += size
    raise DomainError("mcp_image_invalid", "图片尺寸信息不可用")
