/**
 * Teléfonos y mensajes de WhatsApp. Se usa en el navegador y en las pruebas.
 * La app no envía nada por sí sola: arma un enlace de WhatsApp con el mensaje ya
 * escrito y el profesional decide si lo envía.
 */

const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Normaliza un teléfono al formato que pide wa.me (solo dígitos, con código de país).
 * Para números argentinos agrega el 54 y el 9 de celular y quita el 0 y el 15.
 * Devuelve null si no parece un teléfono válido.
 */
export function normalizePhone(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (!digits) return null;
  let international = text.startsWith("+");
  if (digits.startsWith("00")) { digits = digits.slice(2); international = true; }

  if (!international) {
    digits = digits.replace(/^0+/, "");
    if (digits.startsWith("54") && digits.length >= 12) international = true;
    else {
      digits = stripMobilePrefix(digits);
      if (digits.length === 10) return `549${digits}`;
      return null;
    }
  }

  if (digits.startsWith("54")) {
    let rest = digits.slice(2);
    if (rest.startsWith("9")) return rest.length === 11 ? `54${rest}` : null;
    rest = stripMobilePrefix(rest.replace(/^0+/, ""));
    return rest.length === 10 ? `549${rest}` : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Quita el "15" de los celulares argentinos: característica(2-4) + 15 + número = 10 dígitos en total. */
function stripMobilePrefix(digits) {
  if (digits.length !== 12) return digits;
  for (const area of [2, 3, 4]) if (digits.slice(area, area + 2) === "15") return digits.slice(0, area) + digits.slice(area + 2);
  return digits;
}

export function whatsappLink(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/** "2026-10-08T10:30" → { date: Date en UTC, hour, minute } sin depender de la zona horaria. */
function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return { date: new Date(Date.UTC(year, month - 1, day)), hour, minute };
}

export function describeAppointmentTime(start) {
  const parsed = parseLocalDateTime(start);
  if (!parsed) return "";
  const { date, hour, minute } = parsed;
  return `${DAYS_ES[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTHS_ES[date.getUTCMonth()]} a las ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} hs`;
}

export function firstName(fullName) {
  const name = String(fullName ?? "").trim().split(/\s+/)[0] || "";
  return name && !/^paciente$/i.test(name) ? name : "";
}

export function buildReminderMessage({ patientName, start, professionalName }) {
  const when = describeAppointmentTime(start);
  const name = firstName(patientName);
  const lines = [
    `Hola${name ? ` ${name}` : ""}, te recuerdo tu turno ${when ? `el ${when}` : "próximo"}.`,
    "¿Me confirmás tu asistencia? Si no podés venir, avisame así lo reprogramamos."
  ];
  if (professionalName) lines.push(`— ${professionalName}`);
  return lines.join("\n");
}

export function buildPortalMessage({ patientName, link, code, professionalName }) {
  const name = firstName(patientName);
  const lines = [
    `Hola${name ? ` ${name}` : ""}, te comparto el acceso a tu plan de alimentación y a tu seguimiento:`,
    link,
    code ? `Si el enlace no abre, entrá a la misma página e ingresá este código: ${code}` : "",
    "Guardalo en un lugar privado: es solo para vos."
  ].filter(Boolean);
  if (professionalName) lines.push(`— ${professionalName}`);
  return lines.join("\n");
}

export function buildShoppingMessage(list, { patientName } = {}) {
  const name = firstName(patientName);
  const lines = [`Lista de compras${name ? ` para ${name}` : ""}:`];
  for (const category of list?.categories || []) {
    lines.push("", `*${category.name}*`);
    for (const item of category.items || []) lines.push(`• ${item.item}${item.quantity ? ` — ${item.quantity}` : ""}`);
  }
  return lines.join("\n");
}
