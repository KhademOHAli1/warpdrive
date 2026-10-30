"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ContactFollowersButton } from "@/features/contacts/ContactFollowersButton";
import { ContactLabelsControl } from "@/features/contacts/ContactLabelsControl";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useDetailDrawerClose } from "@/features/navigation/detailDrawerClose";
import { ContactActionsMenu } from "./ContactActionsMenu";

type FollowerRef = { id: string; name: string; avatarUrl: string | null };

interface ContactDetailHeaderProps {
  entityId: string;
  name: string;
  labels: string[];
  followers: FollowerRef[];
  isFollowedBySelf: boolean;
  canMerge: boolean;
  canDelete: boolean;
  onMerge: () => void;
  subtitle?: React.ReactNode;
}

function ContactDetailHeaderFrame({
  entityType,
  avatarClassName,
  entityId,
  name,
  labels,
  followers,
  isFollowedBySelf,
  canMerge,
  canDelete,
  onMerge,
  subtitle,
}: ContactDetailHeaderProps & {
  entityType: "person" | "organization";
  avatarClassName: string;
}): React.ReactNode {
  const t = useAppTranslations("contacts");
  const closeDrawer = useDetailDrawerClose();
  return (
    <header className="mb-5 border-b pb-5">
      {closeDrawer === null && (
        <Link
          href={entityType === "person" ? "/contacts/people" : "/contacts/orgs"}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t(entityType === "person" ? "directory.backPeople" : "directory.backOrgs")}
        </Link>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-3">
          <Avatar name={name} className={avatarClassName} />
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t(entityType === "person" ? "directory.personContext" : "directory.orgContext")}
            </p>
            {/* A record name, so it matches EditableHeading's weight rather than a page title's. */}
            <h1 className="break-words text-display font-semibold leading-tight text-foreground">
              <bdi dir="auto">{name}</bdi>
            </h1>
            {subtitle !== undefined && (
              <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
            )}
            <ContactLabelsControl entityType={entityType} entityId={entityId} labels={labels} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ContactFollowersButton
            entityType={entityType}
            entityId={entityId}
            followers={followers}
            isFollowedBySelf={isFollowedBySelf}
          />
          <ContactActionsMenu
            entityType={entityType}
            entityId={entityId}
            canMerge={canMerge}
            canDelete={canDelete}
            onMerge={onMerge}
          />
        </div>
      </div>
    </header>
  );
}

export function PersonDetailHeader(props: ContactDetailHeaderProps): React.ReactNode {
  return (
    <ContactDetailHeaderFrame
      {...props}
      entityType="person"
      avatarClassName="size-11 shrink-0 text-sm"
    />
  );
}

export function OrganizationDetailHeader(props: ContactDetailHeaderProps): React.ReactNode {
  return (
    <ContactDetailHeaderFrame
      {...props}
      entityType="organization"
      avatarClassName="size-11 shrink-0 rounded-lg text-sm"
    />
  );
}
