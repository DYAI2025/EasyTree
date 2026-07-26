# EasyTree – Drei-Repository-Analyse

Stand: 26.07.2026, Europe/Berlin

Dieses Paket analysiert:

1. `EasyTree-master (1).zip`
2. `EasyTree-App-UI-main.zip`
3. `EasyTree-UIUX-main (7).zip`

## Kernaussage

Die drei Repositories sollten nicht als drei gekoppelte Laufzeitsysteme weitergeführt werden. `EasyTree-master` ist die technische Foundation und sollte zum kanonischen Monorepo werden. `EasyTree-UIUX` liefert den Planer-/Management-Clickdummy, `EasyTree-App-UI` die mobile Mitarbeiteroberfläche. Beide UI-Prototypen sollten über gemeinsame Domain- und API-Verträge in den Master integriert werden.

## Dateien

- `AUDIT_REPORT.md` – Gesamtergebnis
- `REPOSITORY_PROFILES.md` – Einzelbeschreibung der drei Repositories
- `INTEGRATION_ARCHITECTURE.md` – empfohlene Übergabeschnittstelle
- `CLICKDUMMY_SCOPE_MATRIX.md` – Abdeckung der geforderten Clickdummy-Ansichten
- `MVP_PRD_GAP_ANALYSIS.md` – PRD-/MVP-Lücken
- `TASK_BACKLOG.md` – priorisierte Taskliste
- `TASK_BACKLOG.csv` – importierbare Tabellenform
- `evidence/evidence-ledger.jsonl` – Evidenzregister

## Evidenzgrenze

Die ZIPs wurden entpackt und der Quelltext statisch inspiziert. Builds, Tests und Browser-Flows konnten in dieser Umgebung nicht erneut ausgeführt werden, weil die Archive keine installierten Abhängigkeiten enthalten und die gepinnte pnpm-Version ohne Registry-Zugriff nicht geladen werden konnte. Runtime- und Produktionsaussagen sind daher nicht verifiziert.
