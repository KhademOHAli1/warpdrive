"use client";

import type React from "react";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import type { BillingMessages } from "../messages";
import type { BillingInvoice, BillingPage, BillingPaymentMethod, BillingReceipt } from "./api";
import { dateLabel, moneyLabel, statusLabel } from "./BillingSummary";

export function BillingHistory({
  messages,
  locale,
  defaultPaymentMethodId,
  paymentMethods,
  invoices,
  receipts,
  loadingKind,
  onLoadMore,
  onDocument,
  onManagePaymentMethods,
}: {
  messages: BillingMessages;
  locale: string;
  defaultPaymentMethodId: string | null;
  paymentMethods: BillingPage<BillingPaymentMethod>;
  invoices: BillingPage<BillingInvoice>;
  receipts: BillingPage<BillingReceipt>;
  loadingKind: "payment-methods" | "invoices" | "receipts" | null;
  onLoadMore: (kind: "payment-methods" | "invoices" | "receipts") => void;
  onDocument: (kind: "invoices" | "receipts", id: string) => void;
  onManagePaymentMethods: () => void;
}): React.ReactNode {
  return (
    <>
      <SettingsCard className="ph-no-capture ph-block-email">
        <SettingsCardHeader
          title={messages.paymentMethods}
          description={messages.paymentMethodsDescription}
        />
        <SettingsCardBody className="p-0">
          {paymentMethods.data.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{messages.paymentMethodsEmpty}</p>
          ) : (
            <ul>
              {paymentMethods.data.map((method) => (
                <li
                  key={method.id}
                  className={`${SETTINGS_TABLE_ROW} flex items-center justify-between gap-3 ${SETTINGS_TABLE_CELL}`}
                >
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{methodLabel(messages, method)}</span>
                    {method.id === defaultPaymentMethodId ? (
                      <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {messages.defaultMethod}
                      </span>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {method.card !== undefined
                        ? `${messages.expires} ${String(method.card.exp_month).padStart(2, "0")}/${method.card.exp_year}`
                        : method.sepa_debit?.country !== undefined
                          ? method.sepa_debit.country
                          : null}
                    </div>
                  </div>
                  <bdi dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                    {maskedLast4(method)}
                  </bdi>
                </li>
              ))}
            </ul>
          )}
        </SettingsCardBody>
        <SettingsCardFooter>
          {paymentMethods.hasMore ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onLoadMore("payment-methods")}
              disabled={loadingKind === "payment-methods"}
            >
              {loadingKind === "payment-methods" ? messages.loadingMore : messages.loadMore}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onManagePaymentMethods}>
            {messages.managePaymentMethods}
          </Button>
        </SettingsCardFooter>
      </SettingsCard>

      <DocumentCard
        title={messages.invoices}
        messages={messages}
        locale={locale}
        rows={invoices}
        loading={loadingKind === "invoices"}
        kind="invoices"
        onLoadMore={onLoadMore}
        onDocument={onDocument}
      />
      <DocumentCard
        title={messages.receipts}
        messages={messages}
        locale={locale}
        rows={receipts}
        loading={loadingKind === "receipts"}
        kind="receipts"
        onLoadMore={onLoadMore}
        onDocument={onDocument}
      />
    </>
  );
}

function methodLabel(messages: BillingMessages, method: BillingPaymentMethod): string {
  if (method.card !== undefined) return `${method.card.brand} ${messages.card}`;
  if (method.sepa_debit !== undefined) return messages.sepaDebit;
  return method.type;
}

function maskedLast4(method: BillingPaymentMethod): string {
  const last4 = method.card?.last4 ?? method.sepa_debit?.last4;
  return last4 === undefined ? "••••" : `•••• ${last4}`;
}

function DocumentCard({
  title,
  messages,
  locale,
  rows,
  loading,
  kind,
  onLoadMore,
  onDocument,
}: {
  title: string;
  messages: BillingMessages;
  locale: string;
  rows: BillingPage<BillingInvoice> | BillingPage<BillingReceipt>;
  loading: boolean;
  kind: "invoices" | "receipts";
  onLoadMore: (kind: "payment-methods" | "invoices" | "receipts") => void;
  onDocument: (kind: "invoices" | "receipts", id: string) => void;
}): React.ReactNode {
  const isInvoice = kind === "invoices";
  return (
    <SettingsCard className="ph-no-capture ph-block-email">
      <SettingsCardHeader title={title} />
      <SettingsCardBody className="overflow-x-auto p-0">
        {rows.data.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{messages.historyEmpty}</p>
        ) : (
          <table className="w-full min-w-[32rem] text-sm">
            <thead className={SETTINGS_TABLE_HEAD}>
              <tr>
                <th className={SETTINGS_TABLE_HEADER_CELL}>{messages.status}</th>
                <th className={SETTINGS_TABLE_HEADER_CELL}>{messages.amount}</th>
                <th className={SETTINGS_TABLE_HEADER_CELL}>{messages.date}</th>
                <th className={SETTINGS_TABLE_HEADER_CELL} />
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => {
                const amount = isInvoice
                  ? (row as BillingInvoice).amount_due
                  : (row as BillingReceipt).amount;
                const currency = isInvoice
                  ? (row as BillingInvoice).currency
                  : (row as BillingReceipt).currency;
                const status = isInvoice
                  ? (row as BillingInvoice).status
                  : (row as BillingReceipt).refunded
                    ? "refunded"
                    : (row as BillingReceipt).status;
                return (
                  <tr key={row.id} className={SETTINGS_TABLE_ROW}>
                    <td className={SETTINGS_TABLE_CELL}>
                      {statusLabel(messages, status ?? "pending")}
                    </td>
                    <td className={`${SETTINGS_TABLE_CELL} whitespace-nowrap`}>
                      <bdi dir="ltr">{moneyLabel(amount, currency, locale)}</bdi>
                    </td>
                    <td className={`${SETTINGS_TABLE_CELL} whitespace-nowrap`}>
                      <bdi dir="ltr">{dateLabel(row.created, locale)}</bdi>
                    </td>
                    <td className={`${SETTINGS_TABLE_CELL} text-end`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          isInvoice &&
                          ((row as BillingInvoice).status === "draft" ||
                            (row as BillingInvoice).invoice_pdf === null)
                        }
                        onClick={() => onDocument(kind, row.id)}
                      >
                        {isInvoice ? messages.downloadInvoice : messages.openReceipt}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsCardBody>
      {rows.hasMore ? (
        <SettingsCardFooter>
          <Button size="sm" variant="ghost" onClick={() => onLoadMore(kind)} disabled={loading}>
            {loading ? messages.loadingMore : messages.loadMore}
          </Button>
        </SettingsCardFooter>
      ) : null}
    </SettingsCard>
  );
}
