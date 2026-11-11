# Amazon SES feedback

The engine accepts signed SNS v2 envelopes at `POST /webhooks/warpdrive/ses` on the newsletter origin. Configure the same commercial AWS region and account for SES and the dedicated SNS topic. The topic must use signature version 2 and deliver the SNS envelope with raw delivery disabled. Set its access policy to allow SES publication only from the selected configuration set and account. SNS signatures authenticate publication to the configured topic, so its publish policy is part of the trust boundary. [SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html) · [SNS signature version](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-configure-message-signature.html) · [SES SNS destination policy](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html)

Set `NEWSLETTER_SES_FEEDBACK_ENABLED=true`, `NEWSLETTER_SES_TOPIC_ARN`, and `NEWSLETTER_SES_CONFIGURATION_SET` in the engine, and enable the matching flag in the newsletter proxy. Configure an SES SMTP relay at the matching regional endpoint with certificate verification enabled. The dedicated configuration set publishes Bounce and Complaint events. The engine confirms a subscription only after verifying the signed, same-topic confirmation and its regional AWS URL. It attaches an opaque delivery UUID through SES's message tags, which SES removes before delivering mail. [Subscription confirmation](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.confirm.html) · [SES SMTP event headers](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-send-email.html)

A verified event must match the ledger UUID and original one-recipient envelope. Permanent bounces and complaints suppress the original address. A changed subscriber address stays enabled. Transient and undetermined bounces appear in the bounce history. A signed SES event can establish provider acceptance independently of a recorded SMTP acknowledgement. The receiver acknowledges notifications after committing the event and its effects together. Keep the provider route active when pausing delivery if existing feedback should still be collected. [SES event fields](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html)

Run the fixture with a packed engine and the corresponding patched Listmonk source.

```sh
python3 -B deploy/newsletters/engine/feedback-tests/verify.py \
  --engine /path/to/listmonk --pg-bin /path/to/postgresql/bin --source /path/to/patched-listmonk
```

The tests sign envelopes with a fixture key and intercept certificate and subscription requests. They use a disposable PostgreSQL cluster and synthetic addresses.
