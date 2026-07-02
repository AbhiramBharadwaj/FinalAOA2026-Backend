import 'dotenv/config';

const payload = {
  from: process.env.RESEND_FROM,
  to: ['m.annapurna22@gmail.com'],
  subject: 'AOACON 2026 Refund Policy and Your Eligibility',
  text: `Dear Dr. Modiam Annapurna,

Greetings from AOACON 2026.

Please find below the Cancellation and Refund Policy for conference registrations:

1. Cancellation by Delegate
All cancellation requests must be made in writing via email to the conference secretariat.

Refund schedule:
- Up to 120 days before the event: 75% refund of the registration fee
- Between 119 to 60 days before the event: 50% refund of the registration fee
- Less than 60 days before the event: No refund will be issued

2. Cancellation by the Organizer
If the conference is canceled due to unforeseen circumstances, all registered delegates will receive a full refund of the registration fee. The organizers are not responsible for other costs such as travel or accommodation.

3. Force Majeure
In case of cancellation or rescheduling due to circumstances beyond control, the organizers will attempt to reschedule and issue revised refund policies.

4. Refund Processing Time
Approved refunds will be processed within 30 days of the cancellation request.

5. No-Show Policy
No refunds will be provided for delegates who do not attend the conference without prior cancellation.

Regarding your registration AOA2026-0013, you are eligible for a 75% refund as your cancellation request has been made before the applicable cutoff for the event starting on October 30, 2026.

Your paid amount is Rs 15,639, and the eligible refund under this policy is approximately Rs 11,729.25.

If you would like to proceed, we will process your written cancellation request accordingly.

Regards,
AOACON 2026 Registration Team`,
  html: `<p>Dear Dr. Modiam Annapurna,</p>
<p>Greetings from AOACON 2026.</p>
<p>Please find below the Cancellation and Refund Policy for conference registrations:</p>
<p><strong>1. Cancellation by Delegate</strong><br>All cancellation requests must be made in writing via email to the conference secretariat.</p>
<p>Refund schedule:<br>- Up to 120 days before the event: 75% refund of the registration fee<br>- Between 119 to 60 days before the event: 50% refund of the registration fee<br>- Less than 60 days before the event: No refund will be issued</p>
<p><strong>2. Cancellation by the Organizer</strong><br>If the conference is canceled due to unforeseen circumstances, all registered delegates will receive a full refund of the registration fee. The organizers are not responsible for other costs such as travel or accommodation.</p>
<p><strong>3. Force Majeure</strong><br>In case of cancellation or rescheduling due to circumstances beyond control, the organizers will attempt to reschedule and issue revised refund policies.</p>
<p><strong>4. Refund Processing Time</strong><br>Approved refunds will be processed within 30 days of the cancellation request.</p>
<p><strong>5. No-Show Policy</strong><br>No refunds will be provided for delegates who do not attend the conference without prior cancellation.</p>
<p>Regarding your registration <strong>AOA2026-0013</strong>, you are eligible for a <strong>75% refund</strong> as your cancellation request has been made before the applicable cutoff for the event starting on <strong>October 30, 2026</strong>.</p>
<p>Your paid amount is <strong>Rs 15,639</strong>, and the eligible refund under this policy is approximately <strong>Rs 11,729.25</strong>.</p>
<p>If you would like to proceed, we will process your written cancellation request accordingly.</p>
<p>Regards,<br>AOACON 2026 Registration Team</p>`,
};

if (!process.env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY not configured');
}

if (!process.env.RESEND_FROM) {
  throw new Error('RESEND_FROM not configured');
}

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const body = await response.text();
console.log(
  JSON.stringify(
    {
      from: process.env.RESEND_FROM,
      status: response.status,
      ok: response.ok,
      body,
    },
    null,
    2
  )
);

if (!response.ok) {
  process.exit(1);
}
