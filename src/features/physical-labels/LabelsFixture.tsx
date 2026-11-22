"use client";

import { useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import type { LabelCommand } from "./contracts";
import { readLabelFixture, resetLabelFixture, runLabelFixture } from "./fixtureState";
import { LabelWorkspace } from "./ui/LabelWorkspace";

type Props = { actorId: string; canManage: boolean };

function FixtureRegistry({ actorId, canManage }: Props) {
  const [generation, setGeneration] = useState(0);
  const [initial, setInitial] = useState(() => readLabelFixture(actorId, canManage));
  function reset() {
    setInitial(resetLabelFixture(actorId, canManage));
    setGeneration((before) => before + 1);
  }

  return (
    <LabelWorkspace
      key={generation}
      initial={initial}
      submit={(command: LabelCommand) =>
        Promise.resolve(runLabelFixture(actorId, canManage, command))
      }
      resetFixture={canManage ? reset : undefined}
      fixture
    />
  );
}

export function LabelsFixture(props: Props) {
  return useHydrated() ? <FixtureRegistry {...props} /> : null;
}
