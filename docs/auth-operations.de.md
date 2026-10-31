# Betriebsanleitung für die Authentifizierungsverwaltung auf dem Host

[English](auth-operations.md) · [فارسی](auth-operations.fa.md) · [Deutsch](auth-operations.de.md)

Diese Befehle laufen auf dem Bereitstellungshost mit dessen Datenbankzugriff. Es gibt dafür keinen HTTP-Endpunkt. Der Hostzugriff ist eine administrative Berechtigung und muss entsprechend geschützt werden. Datenbankgeheimnisse und Verschlüsselungsschlüssel gehören nicht in Kommandozeilenargumente. Verwenden Sie dieselbe validierte Umgebung wie Anwendung und Hintergrunddienst. Die Befehle geben nur allgemeine Ergebnisse aus, niemals Einladungs- oder Rücksetzlinks, Passwörter, Sitzungstoken oder Wiederherstellungscodes.

Im Produktivbetrieb muss `BASE_URL` HTTPS verwenden. Erforderlich sind außerdem ein eigener starker `AUTH_SECRET`, der bestehende stabile `TOKEN_ENCRYPTION_KEY` und eine funktionierende SMTP-Konfiguration. Anwendung, Hostwerkzeug und Hintergrunddienst müssen dieselben Werte verwenden. Setzen Sie im Produktivbetrieb `AUTH_MAIL_TRANSPORT=smtp`; `capture` erfasst lediglich ein Entwicklungsergebnis und stellt keine Nachricht zu. Hinterlegen Sie die überprüfte Adresse des ersten Administratorkontos als `SEED_ADMIN_EMAIL`.

## Befehle im bereitgestellten Container

Das Laufzeit-Image enthält `dist`, nicht den ausgecheckten Quellcode. `bun run build:workers` bündelt das Hostwerkzeug beim Erstellen des Images. Führen Sie diese Befehle mit der vorhandenen Umgebung des Anwendungsdienstes aus:

```sh
bun dist/auth-operator.mjs bootstrap --email owner@example.com --name "Workspace owner" --locale fa --confirm
bun dist/auth-operator.mjs recover --request-id APPROVED_CASE_UUID --confirm
```

Im Quellcode-Checkout lautet der entsprechende Einstiegspunkt `bun run auth:operator`. Beide Varianten verwenden dieselben Dienste und dieselbe Argumentprüfung. Exit-Code 0 bedeutet, dass die Operation bestätigt und die Nachricht in die Warteschlange aufgenommen wurde. 1 bedeutet Ablehnung oder Fehler, 2 ungültige Argumente. Eine Nachricht in der Warteschlange ist kein Zustellnachweis.

## Erstes Administratorkonto

Wenden Sie vor der Erstinitialisierung die aktuellen Datenbankmigrationen an. Starten Sie den regulären Hintergrunddienst, damit sein geplanter Auftrag `auth-maintenance` die verschlüsselten Ausgangsnachrichten zustellen kann. Prüfen Sie HTTPS und SMTP und führen Sie anschließend den Bootstrap-Befehl für das vorgesehene Postfach mit ausdrücklichem `--confirm` aus. Ist `SEED_ADMIN_EMAIL` gesetzt, muss die Adresse damit übereinstimmen. Die Standardsprache ist `fa`; verwenden Sie `--locale de` für Deutsch oder `--locale en` für Englisch.

Bootstrap verwendet die bestehende PostgreSQL-Sperre `815274001` zur Vergabe des ersten Administratorkontos. Eine bereits abgeschlossene Initialisierung oder irgendein vorhandenes CRM-Konto führt zur Ablehnung, auch ein noch nicht mit einer Identität verknüpftes Platzhalterkonto. Vorhandene Identitäten werden weder hochgestuft noch neu verknüpft oder überschrieben. Eine einzige Transaktion legt bei Bedarf die Standardberechtigungen, die Mitgliedschaft in `Everyone` und die initialen Katalogdaten an, erstellt ein neues Administrator-Platzhalterkonto, speichert die Voreinstellungen für Sprache und Kalender, stellt die reguläre befristete Einladung aus, reiht ihre verschlüsselte Nachricht ein und schließt die Erstinitialisierung. Außerhalb der verschlüsselten E-Mail-Nutzdaten wird das Einladungstoken ausschließlich als Hash gespeichert. Der Befehl erstellt keine Better-Auth-Identität, kein Passwort und keine nutzbare Sitzung.

Die eingeladene Person durchläuft die vorhandene Einladungsannahme und E-Mail-Verifizierung. Vor dem Anwendungszugriff muss ein Administratorkonto einen starken Authentifizierungsfaktor einrichten und bestätigen. Für Persisch ist der iranische Kalender voreingestellt, für Deutsch der gregorianische. Die anfängliche Zeitzone bleibt für beide Sprachen `UTC`, bis die Person eine andere auswählt.

Die Erstinitialisierung ist bewusst nur einmal möglich. Bei ausstehender oder fehlgeschlagener Zustellung beheben Sie das SMTP- oder Hintergrunddienstproblem; erneute Zustellversuche sind nur sinnvoll, solange der Einladungslink gültig ist. Einladungen laufen nach 72 Stunden ab. Das Sicherheitsereignis lautet `bootstrap.invitation`.

### Einladung für das noch nicht übernommene erste Administratorkonto erneuern

Die erneute Zustellung einer abgelaufenen Nachricht verlängert die Einladung nicht. Hat die vorgesehene Person das erste Administratorkonto noch nicht übernommen, stellen Sie über diesen ausschließlich auf dem Host verfügbaren Befehl eine neue Einladung aus:

```sh
bun dist/auth-operator.mjs resend-bootstrap --email owner@example.com --confirm
```

Die Empfängeradresse muss mit der gespeicherten Einladung und dem Konto sowie mit `SEED_ADMIN_EMAIL` übereinstimmen, sofern diese Einstellung gesetzt ist. Zulässig sind nur das ursprüngliche einzelne aktive Administrator-Platzhalterkonto, eine geschlossene Erstinitialisierung und eine von diesem Konto selbst ausgestellte, weder angenommene noch widerrufene Einladung. Diese Einladung darf abgelaufen sein. Eine angenommene Einladung, eine vorhandene Better-Auth-Identität oder Google-Kennung, irgendein weiteres Arbeitsbereichskonto und der Austausch der vorgesehenen Administration führen zur Ablehnung. Name und Sprache lassen sich nicht überschreiben; die neue Nachricht behält die gespeicherte Einladungssprache.

Unter Sperre `815274001` widerruft die Operation alte Links, storniert alte Ausgangsnachrichten und erstellt über den regulären Pfad mit gehashtem Token und verschlüsselter E-Mail eine neue, 72 Stunden gültige Einladung. Von überlappenden Aufrufen, die dieselbe Einladung vorfinden, kann nur einer einen Ersatz ausstellen. Ein Warteschlangenfehler rollt sämtliche Änderungen zurück. UUID, Berechtigungen, Gruppenmitgliedschaft, Einstellungen und die geschlossene Erstinitialisierung bleiben erhalten. Das Auditereignis lautet `bootstrap.invitation_renewed`. Der Befehl erneuert eine Einladung; er legt kein weiteres Administratorkonto an und öffnet Bootstrap nicht erneut.

## Reguläre Wiederherstellung nach Verlust eines Faktors

1. Die betroffene Person eröffnet über den vorhandenen Wiederherstellungsablauf einen Antrag zur Faktorwiederherstellung.
2. Eine andere Person mit aktivem Administratorkonto prüft den Fall in der Sicherheitsverwaltung. Die Genehmigung hält die prüfende Person und den Prüfzeitpunkt fest. Ein Konto kann seine eigene Faktorwiederherstellung nicht im Browser genehmigen.
3. Die für den Host verantwortliche Person prüft unabhängig, ob der Antrag zum bisherigen CRM-Kontoinhaber gehört, dokumentiert die Nachweise nach dem vertrauenswürdigen Verfahren der Organisation und führt den genehmigten Fall mit seiner UUID und `--confirm` aus.

Der reguläre CLI-Befehl führt nur bereits genehmigte Fälle aus; er genehmigt selbst keinen Antrag. Er ruft den Wiederherstellungsdienst auf, entfernt registrierte Faktoren, widerruft bestehende Anwendungs- und OAuth-Zugriffe, entfernt wiederverwendbare Integrationsberechtigungen und stößt den regulären Passwort-Rücksetzablauf ausschließlich für die verifizierte E-Mail-Adresse des aktiven Kontos an. CRM-UUID, stabile Benutzerkennungen bei Identitätsanbietern, bestehender Passwort-Hash, Berechtigungen und die Eigentümerzuordnung der Datensätze bleiben erhalten. Der Hintergrunddienst wiederholt den Widerruf bei externen Integrationen, nachdem der lokale Zugriff bereits beendet wurde.

Abschluss, zugehörige Sicherheitsbenachrichtigung und Einreihung der Rücksetzmail erfolgen in einer Transaktion. Abschlussbestätigung und Rücksetzmail sind zwei getrennte Nachrichten. Der Hostdienst prüft das Einfügen in die Ausgangswarteschlange ausdrücklich, weil Better Auth Fehler seines Rücksetzmail-Callbacks absichtlich nicht an den Aufrufer weitergibt. Scheitert die Einreihung, wird die Wiederherstellung zurückgerollt. Ein bereits abgeschlossener Fall kann keine weitere Wiederherstellung auslösen. Das Abschlussereignis lautet `recovery.complete`; die betroffene Person öffnet den Link im Postfach und richtet über die reguläre Oberfläche einen Ersatzfaktor ein.

## Notfall: Das einzige eingerichtete Administratorkonto ist ausgesperrt

Dies ist eine gesonderte Prüfung der Kontoinhaberschaft ausschließlich auf dem Host. Sie akzeptiert nur einen bereits vorhandenen **noch nicht genehmigten Antrag mit Status `pending`** zur Faktorwiederherstellung, dessen Inhaber das einzige eingerichtete aktive Administratorkonto besitzt. Dessen Better-Auth-Identität muss verifiziert sein; die E-Mail-Adressen in CRM und Better Auth müssen übereinstimmen. Inaktive, lediglich eingeladene und nicht verifizierte Konten werden abgewiesen. Gibt es ein weiteres bereits eingerichtetes aktives Administratorkonto, ist dieser Notfallweg gesperrt.

Vor der Ausführung muss eine verantwortliche Person die Kontoinhaberschaft außerhalb der gesperrten Browsersitzung anhand vorhandener Organisationsunterlagen und eines bereits vertrauenswürdigen Kontaktwegs prüfen. Dokumentieren Sie die prüfende Person und die Nachweise im Vorfallverfahren der Organisation. Die Optionen protokollieren die Erklärung dieser Person; sie führen selbst keine Identitätsprüfung durch.

```sh
bun dist/auth-operator.mjs recover --request-id PENDING_SOLE_ADMIN_CASE_UUID --confirm --emergency-last-admin --confirm-ownership
```

Alle drei Optionen sind erforderlich. Der Hostdienst nimmt zuerst die gemeinsame Kontosperre und danach die Zeilensperren für Administration, Identität und Fall. Er prüft die Voraussetzungen erneut, protokolliert `recovery.emergency_review` mit der Methode für die vom Hostbetrieb bestätigte Prüfung der Kontoinhaberschaft und ruft anschließend den bestehenden Wiederherstellungs- und Rücksetzlinkablauf auf. Prüfung, Abschluss, Widerrufe, Auditereignisse und die verschlüsselte Ausgangsnachricht werden atomar bestätigt. Bei gleichzeitiger Ausführung kann nur eine Operation erfolgreich sein. Es gibt keinen öffentlichen Endpunkt, keine Selbstgenehmigung im Browser, keine frei wählbare Zieladresse und kein vom Hostbetrieb festgelegtes Passwort.

## Zustellung, Umstellung und Prüfung

Der reguläre Hintergrunddienst plant `auth-maintenance` minütlich ein. Der Auftrag stellt ausstehende Nachrichten zu, wiederholt Integrationswiderrufe und verarbeitet abgelaufene Authentifizierungsdatensätze. Prüfen Sie Versandstatus und Versuche über die vorhandene Verwaltungsoberfläche. Auf dem Host lässt sich der Gesamtstatus ohne Offenlegung verschlüsselter Nutzdaten abfragen:

```sql
SELECT kind, status, count(*) FROM auth_mail_outbox GROUP BY kind, status;
```

Die Umstellung auf die neue Authentifizierung widerruft bisherige Anwendungssitzungen und zuvor erteilte MCP-Berechtigungen. Benutzer müssen sich erneut anmelden; MCP-Clients benötigen eine neue Autorisierung. Halten Sie vor den Bereitstellungsmigrationen eine verschlüsselte, wiederherstellbare Datenbanksicherung bereit. Ein erfolgreicher Quellcode-Build allein bestätigt weder die Bereitstellung noch die Wiederherstellbarkeit eines Backups.

Mit temporären PostgreSQL-Datenbanken geprüft wurden konkurrierende Erstinitialisierungen, die Ablehnung vorhandener Identitäten, Standarddaten, Sprache und Einladungsspeicherung für das erste Administratorkonto, die Voraussetzungen regulärer und notfallmäßiger Wiederherstellung, die einmalige Ausführung bei konkurrierenden Aufrufen sowie der Rollback bei tatsächlich ausgelösten Datenbankfehlern in der Nachrichtenwarteschlange. Die gebündelte CLI wird auch nach Entfernung ihrer Quellcodepfade gebaut und ausgeführt. Diese Tests versenden keine produktiven E-Mails und bestätigen keinen realen Mandanten eines externen Identitätsanbieters. Berücksichtigen Sie bei der Freigabe weiterhin die offenen Sicherheitsbefunde zu Abhängigkeiten in [auth-dependency-review.md](auth-dependency-review.md).
