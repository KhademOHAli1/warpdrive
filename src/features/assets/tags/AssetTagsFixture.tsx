"use client";

import { useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetTagCommand, AssetTagContactInput, AssetTagScanInput } from "./contracts";
import { runAssetTagFixture } from "./fixtureCommands";
import { projectAssetTagFixture, readAssetTagFixture } from "./fixtureData";
import {
  openOwnerContactFixture,
  scanAssetTagFixture,
  sendOwnerMessageFixture,
} from "./fixtureScans";
import { AssetTagLanding } from "./ui/AssetTagLanding";
import { AssetTagWorkspace } from "./ui/AssetTagWorkspace";

function FixtureRegister({ canManage }: { canManage: boolean }) {
  const [initial] = useState(() => projectAssetTagFixture(readAssetTagFixture(), canManage));
  return (
    <AssetTagWorkspace
      initial={initial}
      submit={(command: AssetTagCommand) => Promise.resolve(runAssetTagFixture(canManage, command))}
      fixture
    />
  );
}

export function AssetTagsFixture({ canManage }: { canManage: boolean }) {
  const hydrated = useHydrated();
  return hydrated ? <FixtureRegister canManage={canManage} /> : null;
}

type LandingFixtureProps = {
  actorId: string | null;
  canManage: boolean;
  token: string;
  signInHref: string;
};

function FixtureLanding({ actorId, canManage, token, signInHref }: LandingFixtureProps) {
  const [assignmentId] = useState(() => openOwnerContactFixture(token));
  const resolve = (input: AssetTagScanInput) =>
    Promise.resolve(
      actorId === null
        ? ({ ok: false, error: "unavailable" } as const)
        : scanAssetTagFixture(actorId, canManage, window.location.origin, input),
    );

  return (
    <AssetTagLanding
      token={token}
      signedIn={actorId !== null}
      signInHref={signInHref}
      contactAvailable={assignmentId !== null}
      resolve={resolve}
      sendMessage={(input: AssetTagContactInput) =>
        Promise.resolve(sendOwnerMessageFixture(input, assignmentId))
      }
      fixture
    />
  );
}

export function AssetTagLandingFixture(props: LandingFixtureProps) {
  const hydrated = useHydrated();
  return hydrated ? <FixtureLanding {...props} /> : null;
}
