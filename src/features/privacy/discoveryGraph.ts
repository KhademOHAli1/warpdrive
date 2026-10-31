import { sql } from "drizzle-orm";
import {
  activityMatch,
  dealMatch,
  discoveryAddressQuery,
  entityMatch,
  leadMatch,
} from "./discoveryAnchors";
import { correspondence, linkedMessage, threadMatch } from "./discoveryContent";
import type { DiscoverySubject } from "./discoveryTypes";

// Repeated correlated graph expansion can exceed the request budget even on small fixtures.
// Materialize shared ID sets inside PostgreSQL, never whole records in application memory.
export function discoveryGraph(subject: DiscoverySubject) {
  return sql`WITH
    privacy_discovery_addresses AS MATERIALIZED (${discoveryAddressQuery(subject)}),
    privacy_discovery_deals AS MATERIALIZED (SELECT d.id FROM deals d WHERE ${dealMatch("d", subject)}),
    privacy_discovery_leads AS MATERIALIZED (SELECT l.id FROM leads l WHERE ${leadMatch("l", subject)}),
    privacy_discovery_activities AS MATERIALIZED (SELECT a.id FROM activities a WHERE ${activityMatch("a", subject)}),
    privacy_discovery_notes AS MATERIALIZED (SELECT n.id FROM notes n WHERE ${entityMatch("n", subject)}),
    privacy_discovery_threads AS MATERIALIZED (SELECT t.id,t.account_id FROM email_threads t WHERE ${threadMatch("t", subject)}),
    privacy_discovery_messages AS MATERIALIZED (SELECT m.id FROM email_messages m WHERE ${linkedMessage("m")} OR ${correspondence("m", true)})`;
}
