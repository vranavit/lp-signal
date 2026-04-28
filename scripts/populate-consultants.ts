/**
 * Workstream 2 Phase A: pre-populate the master consultants list.
 *
 * Inserts 18 known investment consulting firms into public.consultants
 * with their canonical names, alias variants (used by the v1.5-consultants
 * classifier to match extracted strings against canonical entries), and
 * default_specialties (used to infer mandate_type for plans whose
 * disclosure is single-bucket / Category B).
 *
 * Idempotent via ON CONFLICT (canonical_name) DO NOTHING. Re-running
 * after partial completion picks up the missing rows.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   pnpm tsx scripts/populate-consultants.ts
 */

import { Client } from "pg";

type Specialty =
  | "general"
  | "private_equity"
  | "real_estate"
  | "real_assets"
  | "hedge_funds"
  | "infrastructure"
  | "fixed_income"
  | "public_equity"
  | "endowment_consulting";

type ConsultantSeed = {
  canonical_name: string;
  name_aliases: string[];
  default_specialties: Specialty[];
};

// Master list curated 2026-04-27. Order is grouped by primary specialty
// for readability; insert order does not affect correctness.
const CONSULTANTS: ConsultantSeed[] = [
  // General consultants
  {
    canonical_name: "Aon",
    name_aliases: ["Aon Investments", "Aon Hewitt", "Hewitt EnnisKnupp"],
    default_specialties: ["general", "private_equity"],
  },
  {
    canonical_name: "Callan",
    name_aliases: ["Callan Associates", "Callan, LLC", "Callan Holdings"],
    default_specialties: ["general", "private_equity"],
  },
  {
    canonical_name: "Mercer",
    name_aliases: ["Mercer Investments", "Mercer Investment Consulting"],
    default_specialties: ["general"],
  },
  {
    canonical_name: "Meketa Investment Group",
    name_aliases: [
      "Meketa",
      "Meketa Inv. Group",
      "Meketa Investment Group, Inc.",
    ],
    default_specialties: ["general", "private_equity", "real_estate"],
  },
  {
    canonical_name: "NEPC",
    name_aliases: ["New England Pension Consultants", "NEPC, LLC"],
    default_specialties: ["general", "private_equity"],
  },
  {
    canonical_name: "RVK",
    name_aliases: [
      "R.V. Kuhns & Associates",
      "RV Kuhns",
      "RV Kuhns & Associates, Inc.",
    ],
    default_specialties: ["general"],
  },
  {
    canonical_name: "Verus Advisory",
    name_aliases: ["Verus", "Verus Investments"],
    default_specialties: ["general", "private_equity"],
  },
  {
    canonical_name: "Wilshire Advisors",
    name_aliases: ["Wilshire", "Wilshire Associates", "Wilshire Advisors, LLC"],
    default_specialties: ["general", "private_equity"],
  },
  {
    canonical_name: "Cliffwater",
    name_aliases: ["Cliffwater LLC"],
    default_specialties: ["general", "private_equity", "hedge_funds"],
  },
  // PE / alts specialists
  {
    canonical_name: "Aksia",
    name_aliases: ["Aksia LLC", "Aksia, LLC", "AKSIA CA, LLC", "Aksia TorreyCove"],
    default_specialties: ["private_equity", "hedge_funds", "real_assets"],
  },
  {
    canonical_name: "Albourne America",
    name_aliases: ["Albourne", "Albourne Partners", "Albourne America, LLC"],
    default_specialties: ["hedge_funds", "private_equity"],
  },
  {
    canonical_name: "Cambridge Associates",
    name_aliases: ["Cambridge Associates LLC", "Cambridge Associates, LLC"],
    default_specialties: ["private_equity", "endowment_consulting"],
  },
  {
    canonical_name: "Hamilton Lane",
    name_aliases: ["Hamilton Lane Advisors", "Hamilton Lane Advisors, LLC"],
    default_specialties: ["private_equity", "infrastructure"],
  },
  {
    canonical_name: "StepStone Group",
    name_aliases: [
      "StepStone",
      "Stepstone Group, LP",
      "StepStone Real Estate",
      "StepStone Infrastructure",
    ],
    default_specialties: ["private_equity", "real_estate", "infrastructure"],
  },
  // Real estate / real assets
  {
    canonical_name: "Townsend Group",
    name_aliases: ["The Townsend Group"],
    default_specialties: ["real_estate", "real_assets"],
  },
  {
    canonical_name: "Courtland Partners",
    name_aliases: ["Courtland Partners, Ltd."],
    default_specialties: ["real_estate"],
  },
  {
    canonical_name: "ORG Portfolio Management",
    name_aliases: ["ORG"],
    default_specialties: ["real_estate"],
  },
  {
    canonical_name: "Pension Consulting Alliance",
    name_aliases: ["PCA"],
    default_specialties: ["real_estate", "real_assets"],
  },
];

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL not set in environment");
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let inserted = 0;
  let existed = 0;

  try {
    for (const firm of CONSULTANTS) {
      const r = await client.query<{ id: string }>(
        `insert into public.consultants (canonical_name, name_aliases, default_specialties)
         values ($1, $2, $3)
         on conflict (canonical_name) do nothing
         returning id`,
        [firm.canonical_name, firm.name_aliases, firm.default_specialties],
      );
      if (r.rowCount === 1) {
        inserted++;
        console.log(`  [+] ${firm.canonical_name}`);
      } else {
        existed++;
        console.log(`  [=] ${firm.canonical_name} (already existed)`);
      }
    }
  } finally {
    await client.end();
  }

  console.log("");
  console.log(`Inserted ${inserted} consultants, ${existed} already existed`);
  console.log(`Total in master list: ${CONSULTANTS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
