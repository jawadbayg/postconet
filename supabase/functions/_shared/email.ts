/** v1 does not send mail. Kept for a later SMTP/Resend release. */
export async function sendInviteEmail(opts: {
  to: string;
  resourceName: string;
  role: string;
  acceptUrl: string;
  invitedBy: string;
}) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("INVITE_FROM_EMAIL") ?? "PostConet <noreply@mail.postconet.app>";
  if (!key) {
    console.error("RESEND_API_KEY is not set; invitation email was not sent");
    return { sent: false, reason: "email_provider_unconfigured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `${opts.invitedBy} shared “${opts.resourceName}” with you`,
      html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;color:#12151a">
        <h2 style="margin:0 0 12px">PostConet invitation</h2>
        <p>${escapeHtml(opts.invitedBy)} invited you to <strong>${escapeHtml(opts.resourceName)}</strong> as <strong>${escapeHtml(opts.role)}</strong>.</p>
        <p>This invitation is bound to <strong>${escapeHtml(opts.to)}</strong>. Sign up or sign in with that address, then verify your email.</p>
        <p><a href="${opts.acceptUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open invitation</a></p>
        <p style="color:#667085;font-size:13px">The link expires. If you did not expect this, ignore the email.</p>
      </div>`
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Resend error", res.status, detail);
    return { sent: false, reason: "email_send_failed" };
  }
  return { sent: true as const };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}
