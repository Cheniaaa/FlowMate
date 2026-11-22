"""仅将完整、明确的图片字段拒绝转为可恢复回执，不把网络错误记为能力。"""

from flowmate.models.observations import _rejected
from flowmate.models.wire import strict_json


def image_rejection(receipt, request, body, evidence, rejection):
    if (evidence.response_complete and evidence.response_status in {400, 422}
            and isinstance(rejection, dict)
            and _rejected(strict_json(body), request.profile.protocol, rejection).get("vision") is False):
        return receipt.model_copy(update={"confirmed": True, "error": "vision_model_required"})
    return receipt
