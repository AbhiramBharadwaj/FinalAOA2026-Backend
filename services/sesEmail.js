import { SESv2Client, SendEmailCommand, GetAccountCommand } from '@aws-sdk/client-sesv2';

export function buildSesEmail({ to, subject, text, html, attachments = [] }) {
  const from = process.env.SES_FROM_EMAIL || process.env.RESEND_FROM;
  if (!from) throw new Error('SES_FROM_EMAIL is not configured');
  if (!text && !html) throw new Error('Email text or HTML is required');
  const simple = {
    Subject: { Data: subject, Charset: 'UTF-8' },
    Body: {
      ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
      ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
    },
  };
  if (attachments.length) simple.Attachments = attachments.map(a => {
    const content = typeof a.content === 'string' ? Buffer.from(a.content, 'base64') : a.content;
    if (!(content instanceof Uint8Array)) throw new Error('Unsupported SES attachment content');
    const cid = a.cid || a.contentId || a.content_id;
    return {
      FileName: a.filename,
      RawContent: content,
      ContentTransferEncoding: 'BASE64',
      ContentDisposition: cid ? 'INLINE' : 'ATTACHMENT',
      ...(cid ? { ContentId: cid } : {}),
      ...((a.contentType || a.content_type) ? { ContentType: a.contentType || a.content_type } : {}),
    };
  });
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
    Content: { Simple: simple },
    ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
  };
}

// These failures occur before acceptance, or are explicit SES rejections.
// Network timeouts and server failures must not cause a cross-provider retry.
export const canFallbackFromSes = error => [
  'CredentialsProviderError', 'AccessDenied', 'AccessDeniedException',
  'UnrecognizedClientException', 'InvalidClientTokenId', 'ExpiredToken', 'ExpiredTokenException',
  'TooManyRequestsException', 'LimitExceededException',
  'AccountSuspendedException', 'SendingPausedException',
].includes(error?.name);

export function createSesEmailSender({ createClient = config => new SESv2Client(config) } = {}) {
  let client;
  let region;
  const getClient = () => {
    const configuredRegion = process.env.SES_REGION || 'eu-north-1';
    if (!client || region !== configuredRegion) {
      region = configuredRegion;
      client = createClient({ region, maxAttempts: 1,
        requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 } });
    }
    return client;
  };
  return {
    async send(message) {
      const result = await getClient().send(new SendEmailCommand(buildSesEmail(message)));
      if (!result.MessageId) throw new Error('SES acceptance could not be confirmed');
      return { provider: 'ses', messageId: result.MessageId };
    },
    async status() {
      const account = await getClient().send(new GetAccountCommand({}));
      return {
        region: process.env.SES_REGION || 'eu-north-1',
        productionAccess: account.ProductionAccessEnabled,
        sendingEnabled: account.SendingEnabled,
        quota: account.SendQuota,
      };
    },
  };
}

export const sesEmailSender = createSesEmailSender();
