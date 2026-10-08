import { randomInt, randomBytes, randomUUID } from "node:crypto";

type DynamicFn = () => string;

const dynamic: Record<string, DynamicFn> = {
  guid: () => randomUUID(),
  uuid: () => randomUUID(),
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  isoTimestamp: () => new Date().toISOString(),
  randomInt: () => String(randomInt(0, 1000)),
  randomAlphaNumeric: () => randomBytes(8).toString("hex").slice(0, 10),
  randomBoolean: () => String(Math.random() < 0.5),
  randomEmail: () => `user-${randomBytes(4).toString("hex")}@example.test`,
  randomUserName: () => `user_${randomBytes(3).toString("hex")}`,
  randomFirstName: () => pick(["Avery", "Jordan", "Riley", "Quinn", "Morgan", "Casey"]),
  randomLastName: () => pick(["Nguyen", "Patel", "Garcia", "Silva", "Anders", "Khan"]),
  randomFullName: () => `${dynamic.randomFirstName()} ${dynamic.randomLastName()}`,
  randomCity: () => pick(["Lisbon", "Osaka", "Nairobi", "Austin", "Lyon", "Pune"]),
  randomCountry: () => pick(["PT", "JP", "KE", "US", "FR", "IN"]),
  randomIP: () => `${randomInt(1, 223)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`,
  randomIPV6: () => Array.from({ length: 8 }, () => randomBytes(2).toString("hex")).join(":"),
  randomUrl: () => `https://example.test/${randomBytes(3).toString("hex")}`,
  randomHexColor: () => `#${randomBytes(3).toString("hex")}`,
  randomPhone: () => `+1${randomInt(200, 999)}${randomInt(200, 999)}${randomInt(1000, 9999)}`,
  randomPassword: () => randomBytes(12).toString("base64url"),
  randomLoremText: () => "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  randomCompanyName: () => pick(["Northwind", "Contoso", "Initech", "Umbrella", "Hooli"]),
  $randomUUID: () => randomUUID()
};

function pick(list: string[]): string {
  return list[randomInt(0, list.length)] ?? list[0]!;
}

export const DYNAMIC_VARIABLE_NAMES = Object.keys(dynamic).map((k) => `$${k.replace(/^\$/, "")}`);

export function resolveDynamic(name: string): string | undefined {
  const key = name.replace(/^\$/, "");
  const fn = dynamic[key] ?? dynamic[`$${key}`];
  return fn ? fn() : undefined;
}
