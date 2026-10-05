---
name: campaign-analysis
description: Phân tích hiệu quả từng chiến dịch quảng cáo của một client (chi phí, lead, CPL, CAC, ROAS), xếp hạng chiến dịch tốt/kém và đề xuất phân bổ lại ngân sách dưới dạng đề xuất cần người duyệt.
metadata:
  version: 0.1.0
  scope: marketing
  risk: WRITE_HIGH_RISK
  tools: [context.load, analytics.get_campaigns, analytics.get_period_measures, report.create_draft, ads.update_budget]
  triggers:
    - "chiến dịch nào hiệu quả"
    - "phân bổ ngân sách quảng cáo"
    - "campaign performance"
  related: [marketing-analytics, product-marketing]
---

# Campaign analysis

## Trigger
Người dùng muốn biết chiến dịch nào đáng tăng/giảm ngân sách, hoặc tổng kết tuần phát hiện kênh có CPL bất thường.

## Scope
- Đọc chỉ số theo chiến dịch của client hiện tại.
- Được tạo báo cáo nháp (`report.create_draft`, WRITE_LOW_RISK).
- Được **đề xuất** đổi ngân sách (`ads.update_budget`, WRITE_HIGH_RISK) nhưng không bao giờ tự thực hiện.

## Inputs
- `tenantId` từ phiên; kỳ `from`/`to`; context marketing đã gộp (mục tiêu CPL/ROAS nếu có).

## Workflow
1. `analytics.get_campaigns` cho kỳ hiện tại.
2. Tính CPL, CAC, ROAS cho từng chiến dịch bằng bảng công thức chuẩn.
3. Bỏ qua chiến dịch có khối lượng quá nhỏ (dưới 3 lead) khi xếp hạng.
4. Xếp hạng theo mục tiêu trong context (mặc định: ROAS giảm dần, sau đó CPL tăng dần).
5. Với chiến dịch kém hiệu quả: đưa đề xuất `proposedAction = ads.update_budget` kèm `requiresApproval: true`.
6. Lưu kết quả bằng `report.create_draft`.

## Output contract
Danh sách chiến dịch `{ channel, campaignKey, campaignName, totals, metrics }` và các đề xuất
`{ id, priority, title, rationale, proposedAction }`. Mọi đề xuất WRITE_HIGH_RISK có `requiresApproval: true`.

## Security boundary
- Gọi `ads.update_budget` mà không có phê duyệt hợp lệ sẽ bị chặn bởi chính sách công cụ và được ghi audit.
- Người đề xuất không thể tự duyệt đề xuất của mình (ràng buộc four-eyes ở cơ sở dữ liệu).
- Phase 19: `ads.update_budget` chỉ mô phỏng, không gọi API quảng cáo thật.

## Related skills
- `marketing-analytics` cho bức tranh tổng.
- `product-marketing` để kiểm tra thông điệp quảng cáo có khớp định vị.
