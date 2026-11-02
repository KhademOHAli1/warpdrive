# Lokale Vorschau des Integrationsprogramms starten

Diese Anleitung gilt für das getrennte Testprofil, das am 31. Oktober 2026 geprüft wurde.
Ein erfolgreicher Lauf belegt den lokalen Betrieb der beteiligten Dienste. Reale Anbieterkonten,
externe Nachrichten, öffentliche Erreichbarkeit und Veröffentlichung sind damit nicht geprüft.
Diese Anleitung deckt nur das lokale Profil ab; sie schließt weder die Betriebsdokumentation
des gesamten Programms noch `OPS-017` ab.

Die verbindlichen Befehle und der Generator für private Konfiguration stehen in der
[gemeinsamen Anleitung](local-runtime.md). Kopieren Sie keine zusätzlichen Vorlagen mit
geheimen Werten in diese Datei. Befehle, Adressen und Kennungen bleiben unverändert in ASCII.
Sprache, Zifferndarstellung, Kalender und Zeitzone bleiben voneinander unabhängig.

## Zuerst die eigenen Dienste erkennen

| Dienst                          | Adresse oder Ressource                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Anwendung                       | `http://127.0.0.1:3160`                                                                 |
| Natives PostgreSQL 18           | `127.0.0.1:55436`, Datenbank `integration_program_preview`, Rolle `integration_program` |
| Hintergrundverarbeitung         | Eigener Prozess `dist/worker.mjs`                                                       |
| Echtzeitdienst                  | `ws://127.0.0.1:8080` mit `WS_HOST=127.0.0.1`                                           |
| S3-Simulator                    | `http://127.0.0.1:9160`, Bucket `integration-program`                                   |
| Private Konfiguration und Daten | `/tmp/warpdrive-integration-program-private`                                            |

Die Ports `3104`, `3105`, `3116`, `3150`, `5432`, `55432`, `55435` und `9000` gehörten bei der
Bestandsaufnahme anderen Vorschauen oder Diensten. Prüfen Sie den aktuellen Zustand erneut.
Beenden Sie keinen fremden Prozess, um einen Port freizugeben. Temporäre Ports von
Testcontainers gehören zur getrennten Testinfrastruktur.

```sh
lsof -nP -iTCP:3160 -iTCP:55436 -iTCP:8080 -iTCP:9160 -sTCP:LISTEN
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres status
docker --context colima-warpdrive inspect --format '{{.State.Status}} {{index .Config.Labels "codex.owner"}}' warpdrive-integration-program-s3
```

Gleichen Sie Prozessname, Startbefehl, Arbeitsverzeichnis und Listener ab. Das Containerlabel
muss `warpdrive-integration-program` lauten. Starten Sie keinen zweiten Prozess, wenn der
eigene Dienst bereits läuft. Das PostgreSQL-Programm im allgemeinen System-PATH verwies auf
eine alte Version 14 mit fehlender ICU-Bibliothek. Nutzen Sie hier ausdrücklich die Binärdateien
von PostgreSQL 18. Globale Werkzeuge müssen dafür nicht aktualisiert werden.

## Vorhandenes Profil wieder starten

Dieser Ablauf gilt, wenn `runtime.env`, der PostgreSQL-Cluster und der Container bereits
vorhanden sind. Erzeugen Sie keine neuen Schlüssel und wiederholen Sie weder `initdb` noch
`createdb` oder `docker create`. Die private Konfiguration gehört weder in die Terminalausgabe
noch in Git oder öffentliche Nachweise.

Arbeiten Sie im folgenden Checkout oder in einem unabhängig wiederhergestellten Quellklon:

```sh
cd /tmp/warpdrive-integrations-preview-20261031
export PATH=/tmp/warpdrive-bun144/bin:$PATH
bun --version
bun install --frozen-lockfile
bun run build:workers
```

Die Bun-Version muss genau `1.4.4` sein. Verändern Sie die Lockdatei nicht. Löschen Sie
`/tmp/warpdrive-integrations-20261031` erst, wenn eine unabhängige Wiederherstellung geprüft
ist: Dort liegen weiterhin die gemeinsamen Git-Metadaten dieses Worktrees.

Starten Sie nur die bereits vorhandenen, derzeit gestoppten Dienste dieses Profils:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres -l /tmp/warpdrive-integration-program-private/postgres.log -o '-h 127.0.0.1 -p 55436 -k /tmp/warpdrive-integration-program-private' start
docker --context colima-warpdrive start warpdrive-integration-program-s3
```

Wenden Sie anschließend die Migrationen auf die getrennte Datenbank an:

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/migrate.mjs
```

Ein erfolgreicher Lauf endet mit `migrations applied`. Die Ausgabe der Bun-Skripthilfe belegt
keine ausgeführte Migration. Migrationen laufen vorwärts; ein Zurücksetzen kommt nur für die
leeren, entbehrlichen Daten dieses Testprofils infrage.

Führen Sie die folgenden Befehle jeweils in einem eigenen Terminal mit demselben
Arbeitsverzeichnis und dem oben gesetzten PATH aus:

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/worker.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env dist/ws.mjs
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env --bun node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3160
```

Falls ein Produktionsbuild erforderlich ist, erstellen Sie ihn vor dem Start der
Entwicklungsanwendung. Beide verwenden das Verzeichnis `.next` dieses Checkouts. Beenden
Sie deshalb vorher ausschließlich die eigene Entwicklungsanwendung in ihrem Terminal.
Nutzen Sie die getrennte private Buildkonfiguration aus dem
[Abschnitt zu Prüfung und Build](local-runtime.md#run-finite-qualification).
Deren Prüfwerte belegen keinen laufenden TLS- oder SMTP-Dienst. Die Vorschau verwendet
weiterhin den Entwicklungsmodus und erfasst Authentifizierungsmails nur lokal.

## Ein vollständig leeres Testprofil anlegen

Dies ist ein anderer Ablauf als der Neustart. Verwenden Sie ausschließlich für neue,
entbehrliche Daten zunächst den
[gemeinsamen Konfigurationsgenerator](local-runtime.md#recreate-private-configuration-on-a-fresh-profile)
und dann die [Anleitung zum Anlegen des S3-Simulators](local-runtime.md#start-the-s3-simulator).
Der Generator bricht bei einer vorhandenen `runtime.env` ab, damit bestehende Schlüssel
erhalten bleiben. Ersetzen Sie niemals Schlüssel für bereits verschlüsselte Daten.

`initdb` und `createdb` aus der gemeinsamen Anleitung werden nur einmal ausgeführt.
Die dortige `trust`-Authentifizierung ist auf den neuen, ausschließlich an Loopback gebundenen
Testcluster beschränkt. Sie ist keine Produktionskonfiguration. Danach folgen Installation,
Worker-Build, Migration und Dienststart wie oben beschrieben.

Geben Sie bei jedem Docker-Befehl `--context colima-warpdrive` an. Wechseln Sie nicht den
globalen Kontext. Das Hostverzeichnis `/tmp` ist in dieser VM nicht freigegeben. Übertragen Sie
die S3-Konfiguration deshalb mit `docker cp` gemäß der gemeinsamen Anleitung, statt einen
ungültigen Bind-Mount einzurichten. Die maßgebliche Hostdatei behält Modus `0600`. Eine für
den Containerbenutzer lesbare Zwischenkopie entsteht nur im privaten Verzeichnis und wird
danach entfernt. Das Image ist durch seinen Digest festgelegt.

SeaweedFS dient hier als S3-kompatibler Simulator. Das prüft weder MinIO im Produktionsbetrieb
noch Multipart-Uploads im Browser oder einen gehosteten Speicherdienst.

## Begrenzter Diensttest und Prüfung der Profilsperre

Der Smoke-Test setzt ein leeres Profil mit genau den oben genannten Adressen voraus.
Vorhandene Benutzer, Postfächer, Anbieterbindungen, Authentifizierungsmails oder ausstehende
Widerrufe führen zur Ablehnung vor dem Schreiben von Testdaten. Löschen Sie keine bestehenden
Daten, um diese Prüfung zu umgehen.

```sh
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
```

Ein erfolgreicher Lauf liefert `ok:true` und Exitcode `0`. Er verwendet den tatsächlichen
separaten Worker, eine synthetische Anmeldesitzung, authentifizierte WebSockets, echtes
`pg_notify` und ein S3-Objekt. Benutzer, Sitzung, Ticket und Testobjekt werden anschließend
entfernt. Der abgeschlossene Queue-Eintrag bleibt als Nachweis erhalten. Der Lauf prüft keine
Passworteingabe im Browser, MFA oder Identität bei einem echten Anbieter.

Für die Prüfung der Profilsperre ändern Sie die Anwendungsadresse nur für diesen Aufruf:

```sh
BASE_URL=http://127.0.0.1:3161 bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
```

Erwartet werden `profile_refused_before_writes` und Exitcode `1`. Gespeicherte Konfiguration
und laufende Dienste bleiben dabei erhalten. Ergebnisse, Quellstand und eine unabhängige
Kontrolle der Bereinigung stehen im [Smoke-Nachweis](runtime-smoke.md).
Die PostgreSQL-16-Suite mit Testcontainers wird getrennt vom nativen PostgreSQL-18-Profil
qualifiziert; der genaue Testbefehl steht in der gemeinsamen Anleitung.

## Dienste stoppen

Beenden Sie Anwendung, Worker und Echtzeitdienst mit `Ctrl-C` in deren eigenen Terminals.
Nach dem Abgleich von Ressourcennamen und Eigentümerschaft stoppen Sie die beiden übrigen
Dienste mit diesen begrenzten Befehlen:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/warpdrive-integration-program-private/postgres stop -m fast
docker --context colima-warpdrive stop warpdrive-integration-program-s3
```

Beenden Sie nicht pauschal alle Bun- oder PostgreSQL-Prozesse und führen Sie keine globale
Docker-Bereinigung aus. Entfernen Sie weder Datenverzeichnis, Volume und private Konfiguration
noch fremde Checkouts. Reale Anbietertests, öffentliches Hosting und Veröffentlichung benötigen
jeweils eigene Ressourcen, die passende Autorisierung und gesonderte Nachweise.
