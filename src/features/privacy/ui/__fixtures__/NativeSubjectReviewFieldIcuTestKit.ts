import { vi } from "vitest";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
