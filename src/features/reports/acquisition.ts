import "server-only";

import { sql } from "drizzle-orm";
import { ACQUISITION_CHANNELS, type AcquisitionChannel } from "@/lib/acquisition";
import { zonedToUtc } from "@/lib/dates";
import { can, requirePermission, tenantTx, type ClinicContext } from "@/server/auth/context";

export type ChannelKey = AcquisitionChannel | "unknown";
export const REPORT_CHANNELS: ChannelKey[] = [...ACQUISITION_CHANNELS, "unknown"];
export const ACQUISITION_PERIODS = [3, 6, 12] as const;

/** "YYYY-MM" for the first month of a period of `months` months ending with the month of `today`. */
export function periodMonths(today: string, months: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const PENDING = ["submitted", "under_review", "awaiting_information", "alternative_proposed"];

/**
 * Where new patients come from (§6, §19), over whole months in the clinic time zone.
 * "Treated" = at least one completed procedure; production = value of completed procedures
 * (§18 production basis), shown only with `report.financial`.
 */
export async function getAcquisitionReport(ctx: ClinicContext, opts: { today: string; months: number }) {
  requirePermission(ctx, "report.operational");
  const tz = ctx.organization.timezone;
  const months = periodMonths(opts.today, opts.months);
  const from = zonedToUtc(`${months[0]}-01`, "00:00", tz).toISOString();
  const showMoney = can(ctx, "report.financial");
  const showReferrers = can(ctx, "patient.read");

  return tenantTx(ctx, async (tx) => {
    const monthly = await tx.execute<{ channel: string; month: string; n: number }>(sql`
      select coalesce(acquisition_channel::text, 'unknown') as channel, to_char(created_at at time zone ${tz}, 'YYYY-MM') as month, count(*)::int as n
        from patients where created_at >= ${from}::timestamptz group by 1, 2`);

    const value = await tx.execute<{ channel: string; new_patients: number; treated: number; production: string }>(sql`
      select coalesce(p.acquisition_channel::text, 'unknown') as channel, count(*)::int as new_patients,
             count(*) filter (where v.amount is not null)::int as treated, coalesce(sum(v.amount), 0)::text as production
        from patients p
        left join lateral (select sum(pp.unit_price_minor * pp.quantity) as amount from performed_procedures pp
                            where pp.patient_id = p.id and pp.status = 'completed') v on true
       where p.created_at >= ${from}::timestamptz
       group by 1`);

    const bookings = await tx.execute<{ status: string; n: number; with_channel: number }>(sql`
      select status::text as status, count(*)::int as n, count(acquisition_channel)::int as with_channel
        from booking_requests where created_at >= ${from}::timestamptz group by 1`);

    const referrers = showReferrers
      ? await tx.execute<{ id: string; patient_number: string; first_name: string; last_name: string; phone: string | null; n: number }>(sql`
          select r.id, r.patient_number, r.first_name, r.last_name, r.phone, count(*)::int as n
            from patients p join patients r on r.id = p.referred_by_patient_id
           where p.created_at >= ${from}::timestamptz
           group by r.id order by n desc, r.last_name limit 10`)
      : [];

    const byChannel = new Map(value.map((r) => [r.channel as ChannelKey, r]));
    const channels = REPORT_CHANNELS.map((channel) => {
      const r = byChannel.get(channel);
      return {
        channel,
        newPatients: r?.new_patients ?? 0,
        treated: r?.treated ?? 0,
        productionMinor: showMoney ? Number(r?.production ?? 0) : null,
        perMonth: months.map((month) => monthly.find((m) => m.channel === channel && m.month === month)?.n ?? 0),
      };
    });
    const count = (statuses: string[]) => bookings.filter((b) => statuses.includes(b.status)).reduce((s, b) => s + b.n, 0);
    const total = channels.reduce((s, c) => s + c.newPatients, 0);
    return {
      months,
      currency: ctx.organization.defaultCurrency,
      total,
      unknown: channels.find((c) => c.channel === "unknown")!.newPatients,
      treated: channels.reduce((s, c) => s + c.treated, 0),
      channels,
      perMonthTotal: months.map((_, i) => channels.reduce((s, c) => s + c.perMonth[i]!, 0)),
      bookings: {
        received: bookings.reduce((s, b) => s + b.n, 0),
        approved: count(["approved"]),
        declined: count(["declined"]),
        pending: count(PENDING),
        lapsed: count(["withdrawn", "expired"]),
      },
      referrers: referrers.map((r) => ({ id: r.id, patientNumber: r.patient_number, firstName: r.first_name, lastName: r.last_name, phone: r.phone, count: r.n })),
    };
  });
}
