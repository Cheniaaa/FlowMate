"""可调整的产品执行限制；不是Live授权。"""

from pydantic import Field

from flowmate.contracts.base import Contract
from flowmate.contracts.execution import RunLimits
from flowmate.integrations.contracts import McpLimits

SCHEMA_VERSION = 3
API_VERSION = 3
APPLICATION_ID = 0x464D4154
MAX_QUESTION_FIELDS = 12
MAX_QUESTION_OPTIONS = 20
MAX_ANSWER_TEXT_BYTES = 8192


class RuntimeConfig(Contract):
    # 硬接收预算独立于模型正文预算；连接仅由用户显式发现建立。
    mcp_limits: McpLimits = Field(default_factory=lambda: McpLimits(
        request_timeout_seconds=30, max_catalog_bytes=1024 * 1024,
        max_result_bytes=8 * 1024 * 1024, max_pages=100,
    ))
    session_result_capacity: int = Field(default=200, gt=0)
    delivery_max_attempts: int = Field(default=3, gt=0)
    run_limits: RunLimits = Field(default_factory=RunLimits)
    model_concurrency: int = Field(default=3, gt=0)
    file_concurrency: int = Field(default=2, gt=0)
    max_file_bytes: int = Field(default=8 * 1024 * 1024, gt=0)
    max_read_chars: int = Field(default=40000, gt=0)
    max_tool_context_bytes: int = Field(default=8192, gt=0)
    max_batch_files: int = Field(default=32, gt=0)
    max_selected_files: int = Field(default=200, gt=0)
    allowed_text_extensions: list[str] = Field(default_factory=lambda: [".md", ".txt"])
    default_page_size: int = Field(default=100, gt=0)
    max_page_size: int = Field(default=500, gt=0)
    approval_ttl_seconds: int = Field(default=1800, gt=0)
    max_host_frame_bytes: int = Field(default=16 * 1024 * 1024, gt=0)
