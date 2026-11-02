# Sicherer Betrieb von MCP

[فارسی](mcp-security-operations.fa.md) | [Deutsch](mcp-security-operations.de.md) | [English](mcp-security-operations.md)

Für Selbsthoster und Entwickler von Clients. Stand bei Erstellung am 2. November 2026:
Der qualifizierte Quellstand `fc5fae837b4b8e532a8bfd89ff303e941bcf1439` enthält das stabile
Profil mit einer einzelnen Ressource und den Widerruf je Benutzer und Client. Dafür liegen
Quellcode- und Hosted-CI-Nachweise vor. Dieser qualifizierte Stand enthält weder die
Unterstützung von `iss` in Autorisierungsantworten noch die Eindämmung einer Refresh-Token-Familie
nach einer Wiederverwendung. Prüfen Sie spätere Versionen anhand ihrer eigenen Freigabenachweise.
Dieser Leitfaden weist kein Verhalten einer installierten Umgebung nach.
Beginnen Sie mit [MCP-Einrichtung und Werkzeugen](mcp-server.md) sowie den Freigabenachweisen
für die installierte Version.

## Unterstütztes Identitäts- und Kompatibilitätsprofil

Halten Sie `BASE_URL` stabil und verwenden Sie HTTPS, ohne Benutzerinformationen, Query oder Fragment.
Der Issuer ist der unveränderte konfigurierte Wert, einschließlich eines konfigurierten abschließenden Schrägstrichs.
Die einzelne Ressource beziehungsweise Audience ist `BASE_URL`, wobei ein abschließender Schrägstrich
entfernt und `/api/mcp` angehängt wird. Lesen Sie diesen Wert aus
`/.well-known/oauth-protected-resource`; die Metadaten des Autorisierungsservers finden Sie unter
`/.well-known/oauth-authorization-server`.

Senden Sie bei Autorisierung, Codeaustausch und Refresh genau einen nicht leeren Wert für `resource`.
Fehlende, wiederholte (auch identische) oder fremde Ziele führen zu `invalid_target`, bevor
Zugangsdaten nachgeschlagen oder Daten verändert werden. Andere fehlerhafte Anfragen führen zu
`invalid_request`; nicht verwendbare Zugangsdaten für ein gültiges Ziel führen zu `invalid_grant`.
Die Beschränkung auf eine einzelne Ressource ist eine Warpdrive-Richtlinie:
[RFC 8707 Abschnitt 2](https://www.rfc-editor.org/rfc/rfc8707.html#section-2) erlaubt mehrere
Ressourcenindikatoren. Ältere Clients, die `resource` weglassen, müssen angepasst werden.
Bei der Ressource sind Unterschiede in der Groß- und Kleinschreibung von Schema und Host zulässig;
die Bytes von Port und Pfad sowie ein abschließender Schrägstrich bleiben maßgeblich.
Die Schreibweise des Issuers bleibt unverändert. Codes und opake Refresh-Autorisierungen speichern
bei Änderungen von `BASE_URL` keine frühere Zielbindung. Eine Änderung der öffentlichen Identität
erfordert eine gesondert geprüfte Migration und eine neue Zustimmung; die URL zu bearbeiten
ersetzt diese Migration nicht.

Lokale SDK-Testfälle prüfen zustandsloses MCP 2026-07-28 und Streamable HTTP nach dem Stand von 2025
am selben Endpunkt. Das ältere HTTP+SSE wird nicht bereitgestellt; konkrete Versionen externer
Clients sind nicht qualifiziert.

## Grenzen der derzeit umfassenden Autorisierungen

Zugangsdaten sind an einen Benutzer und einen Client gebunden. Freigegebene granulare Fähigkeiten,
Installationsrollen und eine auf Lesezugriffe beschränkte Autorisierung sind nicht implementiert.
Die Übergabe von `scope=read`, das Ausblenden von Werkzeugen im Client oder das Lesen des
`readOnlyHint` eines Werkzeugs beschränkt die serverseitige Autorisierung nicht.
Bestehende Autorisierungen dürfen niemals als stillschweigend auf Lesezugriffe umgestellt beschrieben werden.

Das [Verzeichnis der Operationen](integration-execution/mcp-operation-inventory.md) und die zugehörige
[CSV-Datei](integration-execution/mcp-operation-inventory.csv) dokumentieren die tatsächlich vorhandenen
fachlichen Prüfungen und Lücken, einschließlich Lead-Bearbeitung, Entwurfsverknüpfungen, verknüpfter
Datenprojektionen und indirekter Erinnerungseffekte. Änderungen können bestehende Hintergrundaufgaben
oder Benachrichtigungen auslösen; eine Freigabe daraus abgeleiteter ausgehender Aktionen ist nicht implementiert.
Die Prüfung von Token und handelndem Benutzer je Anfrage weist keine aktuelle Berechtigung für jede
spätere Wirkung nach. Die vollständige Schnittmenge der Berechtigungen, die Durchsetzung reiner
Lesezugriffe und die Autorisierungsmatrix bleiben offen (AISEC-006, AISEC-008, AISEC-023).
Aktivieren Sie umfassenden MCP-Zugriff nur im Bewusstsein dieser Grenzen.

## Umgang mit Codes, Refresh und Clients

Die Registrierung akzeptiert HTTPS, HTTP über Loopback sowie private Callback-Schemata;
HTTP zu entfernten Hosts wird abgelehnt. Verwenden Sie die exakt registrierte Redirect-URI und
S256 PKCE. Erzeugen Sie für jede Autorisierung einen neuen Verifier mit hoher Entropie und
bewahren Sie ihn bis zum Austausch sicher auf. Die S256-Transformation ist in
[RFC 7636 Abschnitt 4.2](https://www.rfc-editor.org/rfc/rfc7636.html#section-4.2) festgelegt.
Ordnen Sie den zurückgegebenen `state` dem gespeicherten Autorisierungsvorgang zu, bevor Sie den Code verwenden
([RFC 6749 Abschnitt 10.12](https://www.rfc-editor.org/rfc/rfc6749.html#section-10.12)).
Speichern Sie vor der Autorisierung den Issuer aus den validierten Metadaten des Autorisierungsservers
zusammen mit dem PKCE/state-Vorgang. Vergleichen Sie einen zurückgegebenen, dekodierten `iss`
zeichengetreu mit diesem gespeicherten Wert. Wenn die Metadaten die Unterstützung einer
Issuer-Angabe in der Antwort ausweisen, lehnen Sie auch ein fehlendes `iss` ab.
Ein fehlendes `iss` bleibt mit dem oben genannten älteren qualifizierten Stand kompatibel.
Prüfen Sie Erfolgs- und Fehlerantworten, bevor Sie einen Code verwenden oder aufgrund von
Fehlerinhalten handeln. Normalisieren Sie den Issuer nicht; siehe
[das festgelegte MCP-Autorisierungsprofil](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
Warpdrive-Codes laufen nach 60 Sekunden ab und sind nur einmal verwendbar. Die Freigabe erfolgt
über die bestehende angemeldete Sitzung unter Anwendung der geltenden Anforderungen an eine
aktuelle Identitätsbestätigung; MCP stellt kein paralleles Anmeldesystem bereit.

Access-Tokens laufen nach einer Stunde ab. Ein neu ausgestelltes Refresh-Token läuft nach 30 Tagen ab.
Eine erfolgreiche Rotation verbraucht das alte Refresh-Token und gibt ein neues Tokenpaar zurück.
Der Ersatz erhält ein eigenes Ablaufdatum. Dies ist keine feste Gesamtlaufzeit der Familie.
Führen Sie Refresh-Vorgänge für dasselbe gespeicherte Token nacheinander aus und speichern Sie
das neue Tokenpaar sicher. Eine verlorene Antwort kann einen unklaren Ausgang hinterlassen;
verwenden Sie das alte Token nicht ungeprüft erneut. Beenden Sie bei `invalid_grant` automatische
Wiederholungsversuche und durchlaufen Sie nach Prüfung der Verbindung eine neue Autorisierung.
Dieser qualifizierte Quellstand bietet bei Wiederverwendung keine Eindämmung nachfolgender Tokens
derselben Familie. Der noch ausstehende Refresh-Kandidat wird nicht als Nachweis
für einen familienbezogenen Widerruf von Access-Tokens ausgewiesen.
Protokollieren Sie keine Bearer-Tokens, Refresh-Tokens, Autorisierungscodes oder PKCE-Verifier.

## Die richtige Maßnahme wählen

Die Schema-Standardwerte aktivieren MCP und erlauben die Registrierung. Prüfen Sie die geladene
Konfiguration der Bereitstellung. Übernehmen Sie Konfigurationsänderungen über den bestehenden
Bereitstellungsmechanismus und starten Sie die bedienenden Anwendungsprozesse bei Bedarf neu.
Das Bearbeiten einer Konfigurationsdatei allein ändert keine bereits laufende Anwendung.

| Maßnahme | Tatsächliche Wirkung | Fortbestehende Zugriffsrechte |
| --- | --- | --- |
| `OAUTH_REGISTRATION=disabled` | `/oauth/register` gibt 404 zurück; die Discovery-Metadaten lassen `registration_endpoint` weg. | Bestehende registrierte Clients können weiterhin autorisieren; bestehende Autorisierungen erlauben weiterhin Codeaustausch und Refresh. |
| `MCP_ENABLED=false` | MCP- und OAuth-Protokollendpunkte einschließlich Discovery geben 404 zurück. | Gespeicherte Codes und Tokens bleiben erhalten; dies ist weder ein Widerruf in der Datenbank noch ein Nachweis, dass laufende Vorgänge gestoppt wurden. |
| Einstellungen > Verbundene Apps > KI-Assistenten > Zugriff widerrufen | Die bestätigte Aktion widerruft die Access- und Refresh-Tokens dieses Benutzers für den ausgewählten Client und verbraucht dessen ausstehende Codes atomar. | Andere Benutzer und Clients behalten ihre Autorisierungen. |

Die Seite „Verbundene Apps“ bleibt verfügbar, wenn MCP ausgeschaltet ist. Ihre Liste enthält
Verbindungen, die nach Ablauf des Access-Tokens noch per Refresh nutzbar sind, aber nicht jeden
registrierten Client und keine vollständige Übersicht über Autorisierungen mit ausschließlich
ausstehenden Codes. Der angezeigte Clientname stammt vom Client selbst und ist keine verifizierte
Herausgeberidentität. Das Entfernen eines Connectors aus einem externen Client ist kein Nachweis
eines serverseitigen Widerrufs. Wenn „Zugriff widerrufen“ einen Fehler meldet, behandeln Sie den
Ausgang weiterhin als ungeklärt. Laden Sie die Seite neu, untersuchen Sie den Fehler oder
wiederholen Sie die bestehende Aktion. Dokumentieren Sie Bestätigung und Umfang, statt Erfolg anzunehmen.

| Symptom | Sichere Prüfpunkte |
| --- | --- |
| 404 | Angefragte Route, geladener MCP-Schalter, Registrierungsrichtlinie; HTTPS-Profil, falls Discovery oder MCP nicht verfügbar ist. |
| `invalid_target` | Genau eine bekannt gegebene Ressource bei Autorisierung und jedem Austausch, einschließlich Refresh. |
| `invalid_request` | Aufbau der Anfrage, Inhaltstyp und erforderliche Parameter. |
| `invalid_grant` | Abgelaufener oder verwendeter Code, Redirect-/Client-/PKCE-Bindung oder ungültiges, abgelaufenes oder widerrufenes Refresh-Token; Prüfung vor erneuter Zustimmung. |
| Abgelehnte Bearer-Authentifizierung | Ablauf oder Widerruf des Access-Tokens, geladener Signaturschlüssel, zeichengetreuer Issuer und Audience sowie aktiver Benutzer. |

## Pflege des Signaturschlüssels

Access-Tokens verwenden HS256. Halten Sie `OAUTH_SIGNING_KEY` geheim und bei gewöhnlichen Neustarts stabil.
Der Schlüssel wird bei der Initialisierung des Moduls beziehungsweise Prozesses gelesen;
es gibt keinen dynamisch aktualisierten Schlüsselbund und kein Verfahren mit überlappenden Schlüssel-IDs.
Der dekodierte Schlüssel muss 32 Bytes lang sein. Er ist weder ein Clientgeheimnis noch der
Verschlüsselungsschlüssel für Provider-Zugangsdaten. Der bestehende `_FILE`-Mechanismus für Geheimnisse ist in
[MCP-Einrichtung](mcp-server.md) beschrieben. Ersetzen Sie bei vermuteter Offenlegung den Schlüssel
über diesen Mechanismus und starten Sie alle bedienenden Anwendungsinstanzen mit derselben
Änderung neu. Sobald alle den Ersatz verwenden, lassen sich alte Signaturen nicht mehr verifizieren.
Opake Refresh-Autorisierungen sind separate Datenbankeinträge: Ein Schlüsselaustausch widerruft sie
nicht. Weiterhin gültige Autorisierungen können Access-Tokens mit Signaturen des neuen Schlüssels
erzeugen. Auch ausstehende opake Codes werden durch den Austausch des Signaturschlüssels nicht
ungültig. Nehmen Sie einen kompromittierten alten Schlüssel nicht wieder in Betrieb.

## Vorfälle mit bestehenden Maßnahmen eindämmen

1. Erfassen Sie über den bestehenden Vorfallsprozess die betroffene Bereitstellung und Version,
   UTC-Zeitpunkte, Benutzer und Client-IDs. Bewahren Sie hilfreiche Fehler- und Statusnachweise auf,
   ohne Geheimnisse zu kopieren.
2. Setzen Sie `MCP_ENABLED=false` und `OAUTH_REGISTRATION=disabled` über den bestehenden
   Bereitstellungsmechanismus. Prüfen Sie, dass jede bedienende Anwendungsinstanz diese Einstellungen
   lädt und dieselben zuvor verifizierten Protokoll-URLs 404 zurückgeben. Eine falsche Route oder
   eine einzelne deaktivierte Instanz weist keine Eindämmung für die gesamte Umgebung nach.
   Ebenso wenig werden dadurch Autorisierungen gelöscht oder bereits zugelassene Vorgänge gestoppt.
3. Lassen Sie jeden betroffenen Benutzer sich bei Warpdrive anmelden und Einstellungen > Verbundene
   Apps > KI-Assistenten öffnen. Er soll den betroffenen aufgeführten Client identifizieren und
   „Zugriff widerrufen“ bestätigen. Prüfen Sie die anschließend angezeigte Seite und dokumentieren
   Sie, welches Benutzer-/Client-Paar bearbeitet wurde. Diese Aktion bleibt bei deaktiviertem MCP verfügbar.
4. Ersetzen Sie einen offengelegten Signaturschlüssel wie oben beschrieben. Beheben Sie die
   festgestellte Ursache und prüfen Sie Identität, Callback und umfassende Zugriffsrechte des
   betroffenen Clients, bevor Sie eine neue Zustimmung zulassen.
5. Halten Sie ungeklärte Benutzer, nicht aufgeführte ausstehende Autorisierungen und unbekannte
   Offenlegungen ausdrücklich fest. Dieses MCP-Verfahren bietet keine getestete Oberfläche oder
   CLI zum Widerruf für alle Benutzer der gesamten Umgebung. Wenn Sie den erforderlichen Bestand
   an Autorisierungen über die unterstützten Maßnahmen nicht vollständig erfassen können, lassen
   Sie MCP bis zu einer qualifizierten administrativen Wiederherstellung deaktiviert.
   Dieser Leitfaden enthält weder SQL für einen Massenwiderruf noch einen ersatzweisen
   Administratorbefehl und weist keine Wiederherstellung nach dem gesamten Vorfall nach.

Befolgen Sie bei einem Vorfall mit einem nativen Konto oder Authentifizierungsfaktor das separate
[Betriebshandbuch für die Authentifizierung](auth-operations.md) unter dessen eigenen Anforderungen
an die Prüfung der Zuständigkeit. Es ist kein allgemeiner Befehl zum Massenwiderruf von MCP-Autorisierungen.

## Erneut aktivieren und neue Zustimmung einholen

Aktivieren Sie MCP erst wieder, wenn die Ursache behoben, der vorgesehene Quellstand qualifiziert
und die erforderlichen Widerrufe nachgewiesen sind. Behalten Sie dieselbe geprüfte Issuer-/Ressourcenidentität bei.
Setzen Sie `MCP_ENABLED=true`. Lassen Sie die Registrierung deaktiviert, sofern ein freigegebener
Client nicht tatsächlich eine neue Registrierung benötigt; schließen Sie die Registrierung nach
dieser begrenzten Einrichtung wieder. Jeder betroffene Benutzer sollte vor einem neuen
Autorisierungsvorgang die alte aufgeführte Autorisierung widerrufen.
Verwerfen Sie alte clientseitige Zugangsdaten, verwenden Sie neue PKCE/state-Werte, prüfen Sie
Callback und Zustimmung und verifizieren Sie einen autorisierten CRM-Lesezugriff ohne Änderung.
Eine neue Zustimmung gewährt weiterhin den oben beschriebenen umfassenden Zugriff.
Eine Seite ohne aufgeführte Verbindung allein weist nicht nach, dass alle ausstehenden Codes
widerrufen wurden. Dokumentieren Sie Zeitpunkte der Deaktivierung und erneuten Aktivierung,
bestätigte Widerrufe je Benutzer, Ergebnisse der neuen Zustimmung und verbleibende Lücken getrennt.
Tests des Quellstands, eine Konfigurationsänderung oder ein einzelner erfolgreicher Lesezugriff
weisen weder den Abschluss eines Vorfalls in der gesamten Bereitstellung noch Browser- oder
Provider-Abnahme oder vollständige RFC-Konformität nach.
