# 微信支付三通道上线与回滚 Runbook

## 前置核验

1. 管理后台完成商户凭据配置，并执行「连接验证」（`/v3/security/echo`）。
2. 人工确认公众号 AppID ↔ 商户号绑定、JSAPI 授权目录 `/pay/`、H5 域名、产品权限。
3. 配置 `PAYMENT_PUBLIC_ORIGIN` / `PAYMENT_PUBLIC_BASE_PATH` / `PAYMENT_PUBLIC_URL`，且与 `PUBLIC_ORIGIN` 不同。
4. Redis 可用（JSAPI OAuth 依赖）；Redis 故障时仅拒绝 JSAPI，Native/H5 仍可工作。
5. Docker 构建上下文不包含 `cert/`、`*.pem`、`*.p12`。

## 推荐上线顺序

1. **备份数据库**。
2. 部署兼容 migration（`0035_wechat_payment_status_enum` → `0036_wechat_payment_attempts`；migrate 按文件单独提交，避免 Postgres enum 55P04）与 inbox / reconcile 代码。
3. 灰度迁移 Native 内核到 attempt 模型（默认仅开放 Native 通道）。
4. 部署 `payment-web`、Gateway `/pay/hui` 路由与外部 Nginx 支付入口。
5. 验证稳定 notify：`https://hui.../api/v1/payments/wechat/notify/{organizationId}`。
6. 验证 OAuth callback：`https://www.../pay/hui/api/v1/payments/wechat/oauth/callback`。
7. 管理后台开启 JSAPI（需 AppSecret + OAuth）。
8. 开启 H5。
9. 最后开放渠道切换（前端手动切换入口）。

## 上线后验证 SQL

```sql
-- 不应出现重复商户订单号
SELECT out_trade_no, COUNT(*) FROM payments
WHERE out_trade_no IS NOT NULL
GROUP BY out_trade_no HAVING COUNT(*) > 1;

-- 不应出现重复微信交易号
SELECT external_id, COUNT(*) FROM payments
WHERE provider = 'wechatpay' AND external_id IS NOT NULL AND status = 'succeeded'
GROUP BY external_id HAVING COUNT(*) > 1;

-- 每单至多一个活动 attempt
SELECT order_id, COUNT(*) FROM payments
WHERE provider = 'wechatpay'
  AND status IN ('preparing','pending','processing','query_pending','close_pending','unknown')
GROUP BY order_id HAVING COUNT(*) > 1;

-- 已支付订单应恰好一张有效票（按业务表调整）
-- SELECT o.id, COUNT(t.id) FROM orders o LEFT JOIN tickets t ON t.order_id = o.id
-- WHERE o.status = 'paid' GROUP BY o.id HAVING COUNT(t.id) <> 1;

-- inbox / 未知状态积压
SELECT status, COUNT(*) FROM payment_notification_inbox GROUP BY status;
SELECT status, COUNT(*) FROM payments
WHERE provider = 'wechatpay'
  AND status IN ('unknown','close_pending','query_pending')
GROUP BY status;
```

## 通知 inbox 重试

HTTP notify 在验签解密并写入 `payment_notification_inbox` 后立即返回 SUCCESS，并异步入账。若异步确认失败，Worker 会按 `PAYMENT_INBOX_INTERVAL_MS`（默认 15s）轮询 `received` / `failed` 行并重试入账；超过 10 次进入 `dead`，需人工按上线后 SQL 排查。

### L1：关闭单个新通道

管理后台关闭 `channels.jsapi` 或 `channels.h5`。不影响存量 notify / 查单 / 关单。

### L2：停止所有新 prepare

关闭 `enabled` 或全部通道开关。保留 notify、主动查单、关单与 reconcile，确保已付款订单仍可入账出票。

### L3：撤销 www 支付页入口

外部 Nginx 停止代理 `/pay/hui`，或 Gateway 摘除 `payment-web`。**不要**停 hui 主站 API 的 notify。存量订单可继续通过查单与回调完成。

数据库新增列默认保留，不做破坏性回滚。

## 真机最小金额验收清单

- [ ] 微信内 JSAPI：授权一次 → 调起支付 → notify 或查单入账 → 仅一张票
- [ ] 手机 Safari/Chrome H5：跳转微信 → 回跳订单页 → 入账
- [ ] PC Native：扫码支付成功
- [ ] iPad Native 默认；手动切换 H5（若已开放）
- [ ] 用户取消、重复 notify、切换通道、订单过期协调

## 安全红线

- openid、AppSecret、商户私钥、order access token 不得进入 URL query、日志或前端持久化（access 仅 fragment → sessionStorage）。
- 稳定 notify 永远在 hui；OAuth/H5 才使用 www/pay/hui。
- 有活动 attempt 时更换 AppID/商户号/APIv3 密钥需谨慎，或保留旧凭据版本处理存量单。
