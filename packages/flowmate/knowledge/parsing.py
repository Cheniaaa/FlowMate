"""UTF-8原文解析与可精确回读的字符分块。"""

import bisect
import hashlib
import re
from typing import Protocol

from flowmate.contracts.base import DomainError
from flowmate.knowledge.contracts import DocumentChunk, ParsedDocument, TextLocator


class Parser(Protocol):
    """返回原字节hash及保留换行的解码原文；定位均以该原文为基准。"""

    def parse(self, raw: bytes, media_type: str) -> ParsedDocument: ...


class Chunker(Protocol):
    def chunk(self, document: ParsedDocument) -> list[DocumentChunk]: ...


class TextParser:
    version = "utf8-markdown-v1"

    def parse(self, raw: bytes, media_type: str) -> ParsedDocument:
        if media_type not in {"text/plain", "text/markdown"}:
            raise DomainError("knowledge_media_type_unsupported", "首版仅支持MD/TXT")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise DomainError("knowledge_encoding_unsupported", "资料必须使用UTF-8编码") from error
        starts = _line_starts(text)
        sections = []
        begin, offset = 0, 0
        headings: list[tuple[int, str]] = []
        current: list[str] = []
        fence: tuple[str, int] | None = None
        for line in text.splitlines(keepends=True):
            if media_type == "text/markdown":
                marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*?)[\r\n]*$", line)
                if fence is not None:
                    if (marker and marker[1][0] == fence[0]
                            and len(marker[1]) >= fence[1] and not marker[2].strip()):
                        fence = None
                elif marker and (marker[1][0] == "~" or "`" not in marker[2]):
                    fence = (marker[1][0], len(marker[1]))
                else:
                    heading = re.match(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?)|)[\r\n]*$", line)
                    if heading:
                        if text[begin:offset].strip():
                            sections.append(_locator(starts, begin, offset, current))
                        depth = len(heading[1])
                        title = re.sub(r"[ \t]+#+[ \t]*$", "", heading[2] or "").strip()
                        headings = [(level, name) for level, name in headings if level < depth]
                        headings.append((depth, title))
                        begin, current = offset, [name for _, name in headings]
            offset += len(line)
        if text[begin:offset].strip():
            sections.append(_locator(starts, begin, offset, current))
        return ParsedDocument(text=text, content_hash=hashlib.sha256(raw).hexdigest(),
                              parser_version=self.version, sections=sections)


class TextChunker:
    version = "heading-window-v1"

    def __init__(self, max_chars: int = 800, overlap_chars: int = 100):
        if max_chars <= 0 or not 0 <= overlap_chars < max_chars:
            raise ValueError("必须满足max_chars > overlap_chars >= 0")
        self.max_chars, self.overlap_chars = max_chars, overlap_chars

    def chunk(self, document: ParsedDocument) -> list[DocumentChunk]:
        text, chunks = document.text, []
        starts = _line_starts(text)
        for section in document.sections:
            begin, finish = section.start_char, section.end_char
            while begin < finish:
                end = min(begin + self.max_chars, finish)
                if end < finish:
                    # 沿用M0：后半窗内才退到段落/行边界，避免极短片段。
                    boundary_begin = begin + max(self.max_chars // 2, self.overlap_chars)
                    boundary = max(text.rfind("\n\n", boundary_begin, end),
                                   text.rfind("\r\n\r\n", boundary_begin, end))
                    if boundary < 0:
                        boundary = text.rfind("\n", boundary_begin, end)
                    if boundary >= 0:
                        # CRLF视为整体，不能在\r和\n之间引入人为边界。
                        end = boundary + (2 if text[boundary] == "\r" else 1)
                fragment = text[begin:end]
                if fragment.strip():
                    chunks.append(DocumentChunk(
                        text=fragment, locator=_locator(starts, begin, end, section.heading_path),
                        parser_version=document.parser_version, chunker_version=self.version,
                    ))
                if end == finish:
                    break
                begin = end - self.overlap_chars
        return chunks


def _line_starts(text: str) -> list[int]:
    starts, offset = [], 0
    for line in text.splitlines(keepends=True):
        starts.append(offset)
        offset += len(line)
    return starts


def _locator(starts: list[int], begin: int, end: int, heading: list[str]) -> TextLocator:
    # 换行属于其所在行；end_char为半开区间，行号为闭区间。
    return TextLocator(
        start_line=bisect.bisect_right(starts, begin),
        end_line=bisect.bisect_right(starts, end - 1),
        start_char=begin, end_char=end, heading_path=heading,
    )
