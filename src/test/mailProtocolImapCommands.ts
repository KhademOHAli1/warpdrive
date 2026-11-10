export interface MailProtocolMessage {
  uid: number;
  source: Buffer;
  flags: string[];
  date: Date;
  advertisedSize?: number;
}

export interface MailProtocolFolder {
  validity: string;
  readOnly: boolean;
  messages: MailProtocolMessage[];
  specialUse?: string | null;
}

export interface MailProtocolImapState {
  folders: Map<string, MailProtocolFolder>;
  sourceFetches: number;
  commands: string[];
  move: boolean;
  stallSelect: boolean;
  stallList?: boolean;
  stallFetch?: boolean;
  fetchExtraRows?: number;
  fetchExtraSource?: Buffer;
  fetchExtraSourceCopies?: number;
  splitFetchRows?: boolean;
  dropMutationResponse?: "STORE" | "MOVE" | "APPEND";
  omitCopyUid?: boolean;
  afterStore?: () => void;
}

export interface MailProtocolSession {
  selected: string;
  authenticated: boolean;
}

function mailboxName(input: string): string {
  return (
    /^"((?:\\.|[^"\\])*)"/.exec(input)?.[1]?.replace(/\\(.)/g, "$1") ?? input.split(" ")[0] ?? ""
  );
}

function ranged(messages: MailProtocolMessage[], range: string): MailProtocolMessage[] {
  const maximum = Math.max(0, ...messages.map((message) => message.uid));
  return messages.filter((message) =>
    range.split(",").some((item) => {
      const [a, b] = item.split(":");
      const start = a === "*" ? maximum : Number(a);
      const end = b === undefined ? start : b === "*" ? maximum : Number(b);
      return message.uid >= Math.min(start, end) && message.uid <= Math.max(start, end);
    }),
  );
}

interface CommandContext {
  state: MailProtocolImapState;
  session: MailProtocolSession;
  tag: string;
  argumentsText: string;
  write: (data: Buffer | string) => void;
}

function completed(context: CommandContext, command: string) {
  context.write(`${context.tag} OK ${command} completed\r\n`);
}

function listFolders(context: CommandContext, command: string) {
  if (context.state.stallList === true) return;
  for (const [path, folder] of context.state.folders)
    context.write(
      `* ${command} (${folder.specialUse == null ? "" : `${folder.specialUse} `}\\HasNoChildren) "/" "${path}"\r\n`,
    );
  completed(context, command);
}

function selectFolder(context: CommandContext, command: string) {
  const { state, session, argumentsText, write, tag } = context;
  const path = mailboxName(argumentsText);
  const folder = state.folders.get(path);
  if (folder === undefined) {
    write(`${tag} NO [NONEXISTENT] Folder missing\r\n`);
    return;
  }
  session.selected = path;
  if (state.stallSelect) return;
  const next = Math.max(0, ...folder.messages.map((message) => message.uid)) + 1;
  write(
    `* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n* ${folder.messages.length} EXISTS\r\n* 0 RECENT\r\n`,
  );
  write(`* OK [UIDVALIDITY ${folder.validity}] validity\r\n* OK [UIDNEXT ${next}] next\r\n`);
  write(
    `* OK [PERMANENTFLAGS (${folder.readOnly ? "" : "\\Seen \\Answered \\Flagged \\Deleted \\Draft \\*"})] flags\r\n`,
  );
  write(
    `${tag} OK [${folder.readOnly || command === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] selected\r\n`,
  );
}

function searchUids(context: CommandContext, folder: MailProtocolFolder, rest: string) {
  const uidRange = /\bUID ([\d:*]+)/i.exec(rest)?.[1];
  const since = /\bSINCE "?([\dA-Za-z-]+)/i.exec(rest)?.[1];
  const messages = (
    uidRange === undefined ? folder.messages : ranged(folder.messages, uidRange)
  ).filter((message) => since === undefined || message.date >= new Date(since));
  context.write(`* SEARCH ${messages.map((message) => message.uid).join(" ")}\r\n`);
  completed(context, "SEARCH");
}

function fetchUids(context: CommandContext, folder: MailProtocolFolder, rest: string) {
  if (context.state.stallFetch === true) return;
  const messages = ranged(folder.messages, rest.split(" ")[0] ?? "");
  const sourceRequested = /BODY(?:\.PEEK)?\[\]/i.test(rest);
  for (const message of messages) {
    const seq = folder.messages.indexOf(message) + 1;
    const fields = `UID ${message.uid} FLAGS (${message.flags.join(" ")}) INTERNALDATE "${imapDate(message.date)}" RFC822.SIZE ${message.advertisedSize ?? message.source.length}`;
    if (sourceRequested) {
      context.state.sourceFetches += 1;
      if (context.state.splitFetchRows === true) context.write(`* ${seq} FETCH (${fields})\r\n`);
      context.write(
        Buffer.concat([
          Buffer.from(
            `* ${seq} FETCH (${context.state.splitFetchRows === true ? `UID ${message.uid}` : fields} BODY[] {${message.source.length}}\r\n`,
          ),
          message.source,
          Buffer.from(")\r\n"),
        ]),
      );
    } else context.write(`* ${seq} FETCH (${fields})\r\n`);
  }
  for (let index = 0; index < (context.state.fetchExtraRows ?? 0); index += 1)
    context.write("* 999 FETCH (UID 999999 FLAGS (\\Seen))\r\n");
  const extraSource = context.state.fetchExtraSource;
  if (extraSource !== undefined)
    for (let index = 0; index < (context.state.fetchExtraSourceCopies ?? 1); index += 1)
      context.write(
        Buffer.concat([
          Buffer.from(`* 999 FETCH (UID 999999 BODY[] {${extraSource.length}}\r\n`),
          extraSource,
          Buffer.from(")\r\n"),
        ]),
      );
  completed(context, "FETCH");
}

function imapDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const time = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()} ${time} +0000`;
}

function storeFlags(context: CommandContext, folder: MailProtocolFolder, rest: string) {
  if (folder.readOnly) {
    context.write(`${context.tag} NO Read only\r\n`);
    return;
  }
  const messages = ranged(folder.messages, rest.split(" ")[0] ?? "");
  const flags = /\(([^)]*)\)/.exec(rest)?.[1]?.split(" ").filter(Boolean) ?? [];
  for (const message of messages) {
    if (rest.includes("+FLAGS")) message.flags = [...new Set([...message.flags, ...flags])];
    else if (rest.includes("-FLAGS"))
      message.flags = message.flags.filter((flag) => !flags.includes(flag));
    else message.flags = flags;
  }
  context.state.afterStore?.();
  completed(context, "STORE");
}

function moveUids(context: CommandContext, folder: MailProtocolFolder, rest: string) {
  const range = rest.split(" ")[0] ?? "";
  const destination = context.state.folders.get(mailboxName(rest.slice(range.length + 1)));
  if (folder.readOnly || !context.state.move || destination === undefined) {
    context.write(`${context.tag} NO Cannot move\r\n`);
    return;
  }
  const messages = ranged(folder.messages, range);
  const moved = messages.map((message) => {
    const uid = Math.max(0, ...destination.messages.map((item) => item.uid)) + 1;
    destination.messages.push({ ...message, uid });
    return uid;
  });
  folder.messages = folder.messages.filter((message) => !messages.includes(message));
  context.write(
    context.state.omitCopyUid === true
      ? `${context.tag} OK moved\r\n`
      : `${context.tag} OK [COPYUID ${destination.validity} ${messages.map((message) => message.uid).join(",")} ${moved.join(",")}] moved\r\n`,
  );
}

const UID_OPERATIONS = new Map<
  string,
  (context: CommandContext, folder: MailProtocolFolder, rest: string) => void
>([
  ["SEARCH", searchUids],
  ["FETCH", fetchUids],
  ["STORE", storeFlags],
  ["MOVE", moveUids],
]);

const AUTHENTICATED_COMMANDS = new Set([
  "LIST",
  "LSUB",
  "NAMESPACE",
  "SELECT",
  "EXAMINE",
  "UID",
  "CHECK",
  "CLOSE",
]);

function uidCommand(context: CommandContext) {
  const folder = context.state.folders.get(context.session.selected);
  if (folder === undefined) {
    context.write(`${context.tag} BAD No folder\r\n`);
    return;
  }
  const operation = context.argumentsText.split(" ")[0]?.toUpperCase() ?? "";
  const handler = UID_OPERATIONS.get(operation);
  context.state.commands.push(operation);
  if (handler === undefined) {
    context.write(`${context.tag} BAD Unsupported UID command\r\n`);
    return;
  }
  handler(context, folder, context.argumentsText.slice(operation.length + 1));
}

export function imapFixtureCommand(
  state: MailProtocolImapState,
  session: MailProtocolSession,
  tag: string,
  command: string,
  argumentsText: string,
  write: (data: Buffer | string) => void,
) {
  const context = { state, session, tag, argumentsText, write };
  state.commands.push(command);
  if (!session.authenticated && AUTHENTICATED_COMMANDS.has(command)) {
    write(`${tag} NO Authenticate first\r\n`);
    return;
  }
  switch (command) {
    case "LIST":
    case "LSUB":
      listFolders(context, command);
      return;
    case "NAMESPACE":
      write('* NAMESPACE (("" "/")) NIL NIL\r\n');
      completed(context, command);
      return;
    case "SELECT":
    case "EXAMINE":
      selectFolder(context, command);
      return;
    case "UID":
      uidCommand(context);
      return;
    case "NOOP":
    case "CHECK":
    case "CLOSE":
      completed(context, command);
      return;
    default:
      write(`${tag} BAD Unsupported ${command}\r\n`);
  }
}

export function completeImapAppend(state: MailProtocolImapState, path: string, source: Buffer) {
  const folder = state.folders.get(path);
  if (folder === undefined || folder.readOnly) return null;
  const uid = Math.max(0, ...folder.messages.map((message) => message.uid)) + 1;
  folder.messages.push({ uid, source, flags: ["\\Seen"], date: new Date() });
  return { uid, validity: folder.validity };
}
