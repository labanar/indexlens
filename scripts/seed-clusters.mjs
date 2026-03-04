#!/usr/bin/env node

/**
 * Seed local Elasticsearch clusters with sample data for screenshots.
 *
 * Usage:
 *   docker compose up -d
 *   node scripts/seed-clusters.mjs
 */

const PRODUCTION_URL = "http://localhost:9200";
const STAGING_URL = "http://localhost:9201";

// ── helpers ────────────────────────────────────────────────────────────────────

async function waitForCluster(url, label, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/_cluster/health`);
      if (res.ok) {
        console.log(`  ✓ ${label} is ready`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label} did not become ready`);
}

async function bulk(url, index, docs) {
  const lines = docs.flatMap((doc) => [
    JSON.stringify({ index: { _index: index } }),
    JSON.stringify(doc),
  ]);
  const body = lines.join("\n") + "\n";
  const res = await fetch(`${url}/_bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body,
  });
  const json = await res.json();
  if (json.errors) {
    const first = json.items.find((i) => i.index?.error);
    console.error("  ✗ Bulk error:", first?.index?.error);
    process.exit(1);
  }
  console.log(`  ✓ ${index}: ${docs.length} docs indexed`);
}

async function putAlias(url, index, alias) {
  await fetch(`${url}/${index}/_alias/${alias}`, { method: "PUT" });
  console.log(`  ✓ alias ${alias} → ${index}`);
}

async function createIndex(url, index, settings = {}) {
  await fetch(`${url}/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

// ── sample data generators ─────────────────────────────────────────────────────

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime()),
  ).toISOString();
}

function generateProducts(count) {
  const categories = [
    "Electronics",
    "Clothing",
    "Books",
    "Home & Garden",
    "Sports",
    "Toys",
  ];
  const adjectives = [
    "Premium",
    "Classic",
    "Ultra",
    "Pro",
    "Essential",
    "Deluxe",
    "Compact",
    "Advanced",
  ];
  const nouns = [
    "Headphones",
    "Keyboard",
    "Backpack",
    "Notebook",
    "Watch",
    "Camera",
    "Speaker",
    "Jacket",
    "Lamp",
    "Chair",
    "Mug",
    "Shoes",
    "Tablet",
    "Monitor",
    "Mouse",
  ];
  const brands = [
    "Apex",
    "Nova",
    "Vertex",
    "Sigma",
    "Orbit",
    "Zenith",
    "Pulse",
    "Flux",
  ];

  return Array.from({ length: count }, (_, i) => ({
    name: `${randomFrom(adjectives)} ${randomFrom(nouns)}`,
    brand: randomFrom(brands),
    category: randomFrom(categories),
    price: parseFloat((Math.random() * 500 + 9.99).toFixed(2)),
    stock: randomBetween(0, 500),
    rating: parseFloat((Math.random() * 3 + 2).toFixed(1)),
    description: `High-quality product #${i + 1} with excellent build and reliability.`,
    created_at: randomDate(new Date("2024-01-01"), new Date("2025-12-31")),
    tags: Array.from(
      { length: randomBetween(1, 3) },
      () => randomFrom(["sale", "new", "bestseller", "limited", "eco", "popular"]),
    ),
  }));
}

function generateOrders(count) {
  const statuses = [
    "pending",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
  ];
  const firstNames = [
    "Alice",
    "Bob",
    "Charlie",
    "Diana",
    "Eve",
    "Frank",
    "Grace",
    "Henry",
  ];
  const lastNames = [
    "Johnson",
    "Smith",
    "Williams",
    "Brown",
    "Davis",
    "Miller",
    "Wilson",
    "Moore",
  ];
  const cities = [
    "New York",
    "London",
    "Tokyo",
    "Berlin",
    "Sydney",
    "Toronto",
    "Paris",
    "Mumbai",
  ];

  return Array.from({ length: count }, (_, i) => ({
    order_id: `ORD-${String(1000 + i).padStart(5, "0")}`,
    customer: `${randomFrom(firstNames)} ${randomFrom(lastNames)}`,
    email: `user${i}@example.com`,
    city: randomFrom(cities),
    items: randomBetween(1, 5),
    total: parseFloat((Math.random() * 800 + 15).toFixed(2)),
    status: randomFrom(statuses),
    payment_method: randomFrom(["credit_card", "paypal", "bank_transfer"]),
    ordered_at: randomDate(new Date("2025-01-01"), new Date("2025-12-31")),
  }));
}

function generateCustomers(count) {
  const firstNames = [
    "Liam",
    "Olivia",
    "Noah",
    "Emma",
    "James",
    "Sophia",
    "Lucas",
    "Mia",
    "Ethan",
    "Ava",
    "Mason",
    "Isabella",
    "Logan",
    "Charlotte",
    "Aiden",
    "Amelia",
  ];
  const lastNames = [
    "Anderson",
    "Thomas",
    "Jackson",
    "White",
    "Harris",
    "Martin",
    "Garcia",
    "Clark",
    "Lewis",
    "Walker",
    "Hall",
    "Allen",
    "Young",
    "King",
    "Wright",
    "Hill",
  ];
  const tiers = ["free", "basic", "premium", "enterprise"];
  const countries = [
    "US",
    "UK",
    "DE",
    "JP",
    "AU",
    "CA",
    "FR",
    "IN",
    "BR",
    "NL",
  ];

  return Array.from({ length: count }, (_, i) => {
    const first = randomFrom(firstNames);
    const last = randomFrom(lastNames);
    return {
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      country: randomFrom(countries),
      tier: randomFrom(tiers),
      lifetime_value: parseFloat((Math.random() * 5000).toFixed(2)),
      orders_count: randomBetween(1, 50),
      registered_at: randomDate(new Date("2022-01-01"), new Date("2025-06-01")),
      active: Math.random() > 0.15,
    };
  });
}

function generateLogs(count, date) {
  const levels = ["INFO", "WARN", "ERROR", "DEBUG"];
  const services = [
    "api-gateway",
    "auth-service",
    "order-service",
    "payment-service",
    "notification-service",
  ];
  const messages = [
    "Request processed successfully",
    "Connection pool exhausted, retrying",
    "Cache miss for key",
    "Rate limit exceeded for client",
    "Health check passed",
    "Timeout waiting for downstream",
    "Invalid authentication token",
    "Database query completed",
    "Message published to queue",
    "Circuit breaker tripped",
  ];

  return Array.from({ length: count }, () => ({
    "@timestamp": randomDate(
      new Date(`${date}-01`),
      new Date(`${date}-28`),
    ),
    level: randomFrom(levels),
    service: randomFrom(services),
    message: randomFrom(messages),
    response_time_ms: randomBetween(1, 2000),
    status_code: randomFrom([200, 200, 200, 201, 400, 401, 404, 500]),
    trace_id: crypto.randomUUID(),
  }));
}

// ── seed ────────────────────────────────────────────────────────────────────────

async function seedProduction() {
  console.log("\n📦 Seeding Production cluster...");

  // Products with mapping
  await createIndex(PRODUCTION_URL, "products", {
    mappings: {
      properties: {
        name: { type: "text" },
        brand: { type: "keyword" },
        category: { type: "keyword" },
        price: { type: "float" },
        stock: { type: "integer" },
        rating: { type: "float" },
        description: { type: "text" },
        created_at: { type: "date" },
        tags: { type: "keyword" },
      },
    },
  });
  await bulk(PRODUCTION_URL, "products", generateProducts(80));
  await putAlias(PRODUCTION_URL, "products", "products-live");

  // Orders
  await createIndex(PRODUCTION_URL, "orders", {
    mappings: {
      properties: {
        order_id: { type: "keyword" },
        customer: { type: "text" },
        email: { type: "keyword" },
        city: { type: "keyword" },
        items: { type: "integer" },
        total: { type: "float" },
        status: { type: "keyword" },
        payment_method: { type: "keyword" },
        ordered_at: { type: "date" },
      },
    },
  });
  await bulk(PRODUCTION_URL, "orders", generateOrders(50));

  // Customers
  await createIndex(PRODUCTION_URL, "customers", {
    mappings: {
      properties: {
        name: { type: "text" },
        email: { type: "keyword" },
        country: { type: "keyword" },
        tier: { type: "keyword" },
        lifetime_value: { type: "float" },
        orders_count: { type: "integer" },
        registered_at: { type: "date" },
        active: { type: "boolean" },
      },
    },
  });
  await bulk(PRODUCTION_URL, "customers", generateCustomers(30));

  // Logs (time-series) — avoid "logs-*" which ES 8.x reserves for data streams
  for (const month of ["2025-01", "2025-02", "2025-03"]) {
    const indexName = `server-logs-${month}`;
    await createIndex(PRODUCTION_URL, indexName);
    await bulk(PRODUCTION_URL, indexName, generateLogs(40, month));
  }
  await putAlias(PRODUCTION_URL, "server-logs-2025-01", "all-logs");
  await putAlias(PRODUCTION_URL, "server-logs-2025-02", "all-logs");
  await putAlias(PRODUCTION_URL, "server-logs-2025-03", "all-logs");
  await putAlias(PRODUCTION_URL, "server-logs-2025-03", "logs-latest");

  // Refresh
  await fetch(`${PRODUCTION_URL}/_refresh`, { method: "POST" });
}

async function seedStaging() {
  console.log("\n📦 Seeding Staging cluster...");

  await createIndex(STAGING_URL, "products-staging", {
    mappings: {
      properties: {
        name: { type: "text" },
        brand: { type: "keyword" },
        category: { type: "keyword" },
        price: { type: "float" },
        stock: { type: "integer" },
      },
    },
  });
  await bulk(STAGING_URL, "products-staging", generateProducts(15));

  await createIndex(STAGING_URL, "experiments");
  await bulk(STAGING_URL, "experiments", [
    { experiment: "A/B header", variant: "A", conversions: 142, impressions: 1000 },
    { experiment: "A/B header", variant: "B", conversions: 167, impressions: 1000 },
    { experiment: "pricing-page", variant: "control", conversions: 89, impressions: 500 },
    { experiment: "pricing-page", variant: "new-layout", conversions: 112, impressions: 500 },
  ]);

  // Refresh
  await fetch(`${STAGING_URL}/_refresh`, { method: "POST" });
}

// ── main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Waiting for Elasticsearch clusters...");
  await waitForCluster(PRODUCTION_URL, "Production");
  await waitForCluster(STAGING_URL, "Staging");

  await seedProduction();
  await seedStaging();

  console.log("\n✅ All clusters seeded successfully!\n");
  console.log("Clusters:");
  console.log(`  Production → ${PRODUCTION_URL}`);
  console.log(`  Staging    → ${STAGING_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
