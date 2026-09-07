/**
 * Feldruebergreifende Invarianten des EasyTree-Delivery-Contracts
 * (EYT-162, Slice 1).
 *
 * WARUM EINE REGISTRY UND KEINE VERSTREUTEN PRUEFUNGEN
 * ---------------------------------------------------
 * Dieselbe Konvention wie `apps/api/test/domain-invariants/registry.ts`: jede
 * Regel traegt eine stabile ID und einen Zweck. Die Testsuite vergleicht die
 * Menge der IDs mit der Menge der Regeln, die sie tatsaechlich rot bekommt.
 * Eine Invariante ohne Test macht die Suite rot — sonst liefe hier eine
 * ungeprueft mit und stuende trotzdem im Bericht.
 *
 * ABGRENZUNG ZUR STRUKTURPRUEFUNG
 * -------------------------------
 * `contract-model.mjs` prueft EINZELNE Felder gegen das Schema. Hier stehen
 * nur Aussagen, die mehrere Felder gleichzeitig betreffen — und die Regeln,
 * die ausdruecklich NUR fuer Slice 1 gelten (`slice-1-*`). Letztere sind
 * bewusst als eigene IDs benannt, damit ein spaeterer Slice sie einzeln
 * loesen kann, ohne das Modell anzufassen.
 *
 * WAS DIESE REGELN NICHT LEISTEN
 * ------------------------------
 * Sie pruefen die AUSSAGE des Vertrags, nicht die Welt. Ob ein PASS wirklich
 * gemessen wurde, ob der Kandidaten-SHA im Repository existiert und ob das
 * Diff im erlaubten Scope liegt, sieht Slice 1 nicht. Der Vertrag liegt
 * ausserdem auf dem Branch des Implementierers und ist damit von ihm
 * schreibbar — `acceptance-authority-not-implementer` faengt die
 * ausgeschriebene Selbstzertifizierung, nicht die Schreibrechte.
 */

/** Zustaende, die das zugehoerige Gate bestanden voraussetzen. */
const ZUSTAND_BRAUCHT_GATE = {
  IC: "ic",
  R2G: "r2g",
  R4M: "r4m",
  MERGED: "r4m",
};

/** Grenzen, die ein Slice-1-Vertrag ausdruecklich nennen muss. */
const PFLICHT_GRENZEN = [
  "NO_CI_ENFORCEMENT",
  "NO_INDEPENDENT_ACCEPTOR",
  "NO_SOURCE_FRESHNESS_ENFORCEMENT",
  "NO_AGENT_HOOK_PARITY",
  "NO_MERGE_BLOCKING",
  "BRANCH_OWNED_CONTRACT_IS_NOT_ACCEPTANCE_EVIDENCE",
];

const gate = (v, name) => v?.gates?.[name] ?? {};
const istPass = (v, name) => gate(v, name).state === "PASS";

/**
 * Jede Regel liefert eine Liste von Meldungen (leer = bestanden).
 *
 * Die Regeln laufen NUR, wenn die Strukturpruefung sauber war. Sonst muesste
 * jede Regel zusaetzlich Typen pruefen, und ein Tippfehler im Schema wuerde
 * als Invariantenverletzung erscheinen statt als Strukturfehler.
 */
export const INVARIANTEN = [
  {
    id: "authority-model-is-derived-projection",
    zweck:
      "Der Vertrag ist eine abgeleitete Projektion. Ein Vertrag, der sich selbst Merge-Autoritaet zuschreibt, kehrt die Autoritaetskette um.",
    pruefe(v) {
      const m = [];
      if (v.authority_model.non_authoritative !== true) {
        m.push("authority_model.non_authoritative muss true sein");
      }
      if (v.authority_model.confers_merge_authority !== false) {
        m.push("authority_model.confers_merge_authority muss false sein");
      }
      return m;
    },
  },
  {
    id: "slice-1-shadow-only",
    zweck:
      "Slice 1 stellt Repraesentation und Pruefung bereit, keine vertrauenswuerdige Durchsetzung. ADVISORY oder REQUIRED waere eine Behauptung ueber eine Grenze, die es noch nicht gibt.",
    pruefe(v) {
      return v.enforcement_mode === "SHADOW"
        ? []
        : [`enforcement_mode '${v.enforcement_mode}' ist in Slice 1 nicht zulaessig (nur SHADOW)`];
    },
  },
  {
    id: "slice-1-acceptance-not-accepted",
    zweck: "Ohne unabhaengigen Acceptor kann in Slice 1 nichts angenommen sein.",
    pruefe(v) {
      return v.acceptance_state === "NOT_ACCEPTED"
        ? []
        : [`acceptance_state '${v.acceptance_state}' ist in Slice 1 nicht zulaessig`];
    },
  },
  {
    id: "slice-1-acceptance-authority-unresolved",
    zweck:
      "In Slice 1 existiert keine unabhaengige Acceptor-Instanz. Einen Namen einzutragen waere eine erfundene Autoritaet.",
    pruefe(v) {
      return v.acceptance_authority.resolution === "UNRESOLVED"
        ? []
        : ["acceptance_authority.resolution muss in Slice 1 UNRESOLVED sein"];
    },
  },
  {
    id: "acceptance-authority-not-implementer",
    zweck:
      "Der Implementierer darf sich nicht selbst annehmen. Deterministisch pruefbar sind zwei Formen: die ausgeschriebene Selbstbehauptung und ein Acceptor, der mit dem Implementierer identisch ist.",
    pruefe(v) {
      const m = [];
      if (v.acceptance_authority.asserted_by_implementer !== false) {
        m.push("acceptance_authority.asserted_by_implementer muss false sein");
      }
      if (
        v.acceptance_authority.acceptor_ref !== null &&
        v.acceptance_authority.acceptor_ref === v.implementation_agent.ref
      ) {
        m.push(
          `acceptance_authority.acceptor_ref ist identisch mit implementation_agent.ref ('${v.implementation_agent.ref}')`,
        );
      }
      return m;
    },
  },
  {
    id: "acceptance-authority-resolution-consistency",
    zweck:
      "RESOLVED ohne Referenz waere eine Annahme ohne Annehmenden; UNRESOLVED mit Referenz waere eine Referenz ohne Geltung.",
    pruefe(v) {
      const { resolution, acceptor_ref: ref } = v.acceptance_authority;
      if (resolution === "RESOLVED" && ref === null) {
        return ["acceptance_authority.resolution RESOLVED verlangt einen acceptor_ref"];
      }
      if (resolution === "UNRESOLVED" && ref !== null) {
        return ["acceptance_authority.resolution UNRESOLVED vertraegt keinen acceptor_ref"];
      }
      return [];
    },
  },
  {
    id: "acceptance-state-requires-resolved-authority",
    zweck: "Angenommen kann nur werden, wenn feststeht, wer angenommen hat.",
    pruefe(v) {
      return v.acceptance_state === "ACCEPTED" && v.acceptance_authority.resolution !== "RESOLVED"
        ? ["acceptance_state ACCEPTED verlangt eine aufgeloeste acceptance_authority"]
        : [];
    },
  },
  {
    id: "r2g-pass-requires-candidate-sha",
    zweck:
      "R2G ist eine Aussage ueber einen konkreten Kandidaten. Ohne candidate_sha gibt es nichts, worauf sich das PASS bezoege.",
    pruefe(v) {
      return istPass(v, "r2g") && v.candidate_sha === null
        ? ["gates.r2g.state PASS ohne candidate_sha"]
        : [];
    },
  },
  {
    id: "gate-pass-requires-current-candidate-sha",
    zweck:
      "Ein PASS, das gegen einen anderen SHA gemessen wurde als den aktuellen Kandidaten, ist veraltet — genau die Form, in der ein alter gruener Zustand weitergeschleppt wird.",
    pruefe(v) {
      const m = [];
      for (const name of ["ic", "r2g", "r4m"]) {
        const g = gate(v, name);
        if (g.state !== "PASS") continue;
        if (g.evaluated_against_sha === null) {
          m.push(`gates.${name} ist PASS, nennt aber keinen evaluated_against_sha`);
        } else if (g.evaluated_against_sha !== v.candidate_sha) {
          m.push(
            `gates.${name}.evaluated_against_sha (${g.evaluated_against_sha}) weicht vom candidate_sha (${String(v.candidate_sha)}) ab`,
          );
        }
      }
      return m;
    },
  },
  {
    id: "r4m-pass-requires-r2g-pass",
    zweck: "R4M setzt R2G voraus. Ein R4M ueber einem roten R2G ueberspringt das Gate davor.",
    pruefe(v) {
      return istPass(v, "r4m") && !istPass(v, "r2g")
        ? [`gates.r4m ist PASS, gates.r2g steht aber auf '${gate(v, "r2g").state}'`]
        : [];
    },
  },
  {
    id: "r4m-pass-requires-same-candidate-sha",
    zweck:
      "R4M und R2G muessen denselben Kandidaten meinen, sonst zertifiziert R4M einen Stand, den R2G nie gesehen hat.",
    pruefe(v) {
      if (!istPass(v, "r4m") || !istPass(v, "r2g")) return [];
      const r4m = gate(v, "r4m").evaluated_against_sha;
      const r2g = gate(v, "r2g").evaluated_against_sha;
      return r4m === r2g
        ? []
        : [
            `gates.r4m (${String(r4m)}) und gates.r2g (${String(r2g)}) beziehen sich auf verschiedene SHAs`,
          ];
    },
  },
  {
    id: "invalidation-requires-metadata",
    zweck:
      "INVALIDATED ist ein erstklassiger Zustand. Ohne Begruendung waere er von 'noch nicht geprueft' nicht unterscheidbar.",
    pruefe(v) {
      const invalidiert = ["ic", "r2g", "r4m"].filter((n) => gate(v, n).state === "INVALIDATED");
      if (invalidiert.length === 0) return [];
      const m = [];
      if (v.invalidation.invalidated !== true) {
        m.push(
          `Gates ${invalidiert.join(", ")} sind INVALIDATED, invalidation.invalidated ist aber nicht true`,
        );
      }
      if (v.invalidation.reason === null) {
        m.push("invalidation.reason fehlt, obwohl ein Gate INVALIDATED ist");
      }
      if (v.invalidation.at === null) {
        m.push("invalidation.at fehlt, obwohl ein Gate INVALIDATED ist");
      }
      return m;
    },
  },
  {
    id: "invalidated-contract-has-no-pass",
    zweck:
      "Ist der Vertrag invalidiert, darf kein Gate weiter gruen stehen — sonst ueberlebt der alte gruene Zustand die Invalidierung.",
    pruefe(v) {
      if (v.invalidation.invalidated !== true) return [];
      const gruen = ["ic", "r2g", "r4m"].filter((n) => istPass(v, n));
      return gruen.length === 0
        ? []
        : [`invalidation.invalidated ist true, aber gates ${gruen.join(", ")} stehen auf PASS`];
    },
  },
  {
    id: "state-requires-gate-pass",
    zweck:
      "Der Lieferzustand ist eine Zusammenfassung der Gates, keine unabhaengige Behauptung. Ein Zustand ohne sein Gate waere genau diese Behauptung.",
    pruefe(v) {
      const benoetigt = ZUSTAND_BRAUCHT_GATE[v.state];
      if (!benoetigt) return [];
      return istPass(v, benoetigt)
        ? []
        : [
            `state '${v.state}' verlangt gates.${benoetigt} = PASS, dort steht '${gate(v, benoetigt).state}'`,
          ];
    },
  },
  {
    id: "paths-disjoint",
    zweck:
      "Ein Pfad, der zugleich erlaubt und verboten ist, macht jedes spaetere Scope-Gate mehrdeutig — und mehrdeutig heisst in der Praxis: die mildere Auslegung gewinnt.",
    pruefe(v) {
      const verboten = new Set(v.forbidden_paths);
      const doppelt = v.allowed_paths.filter((p) => verboten.has(p));
      return doppelt.length === 0
        ? []
        : [`Pfade stehen in allowed_paths UND forbidden_paths: ${doppelt.join(", ")}`];
    },
  },
  {
    id: "source-bindings-name-upstream-authority",
    zweck:
      "Der Vertrag muss auf die vorgelagerte Autoritaet zeigen, aus der er abgeleitet ist. Ohne Jira-Bindung auf den eigenen Vorgang waere er eine freistehende zweite Wahrheit.",
    pruefe(v) {
      const passend = v.source_bindings.some(
        (b) =>
          b.authority === "JIRA" &&
          b.binding_kind === "ACCEPTANCE_CRITERIA" &&
          b.ref === v.jira_key,
      );
      return passend
        ? []
        : [`keine JIRA/ACCEPTANCE_CRITERIA-Bindung auf den eigenen jira_key '${v.jira_key}'`];
    },
  },
  {
    id: "slice-1-declares-known-boundaries",
    zweck:
      "Ein gruener Lauf darf nicht als mehr gelesen werden, als er ist. Deshalb muss der Vertrag seine eigenen Grenzen mitfuehren.",
    pruefe(v) {
      const vorhanden = new Set(v.known_boundaries);
      const fehlend = PFLICHT_GRENZEN.filter((g) => !vorhanden.has(g));
      return fehlend.length === 0 ? [] : [`known_boundaries nennt nicht: ${fehlend.join(", ")}`];
    },
  },
];

/** Stabile Liste der Regel-IDs. Die Testsuite vergleicht sie mit ihrer Abdeckung. */
export const INVARIANT_IDS = INVARIANTEN.map((regel) => regel.id);

/**
 * Fuehrt alle Invarianten aus.
 *
 * @param {object} vertrag strukturell bereits gueltiger Vertrag
 * @returns {{ regel: string, pfad: string, meldung: string }[]}
 */
export function pruefeInvarianten(vertrag) {
  const befunde = [];
  for (const regel of INVARIANTEN) {
    for (const meldung of regel.pruefe(vertrag)) {
      befunde.push({ regel: regel.id, pfad: "", meldung });
    }
  }
  return befunde;
}
