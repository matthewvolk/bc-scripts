/**
 * This script copies products from channel 1 to a channel read from the
 * BIGCOMMERCE_CHANNEL_ID environment variable.
 *
 * Required Environment Variables:
 * - BIGCOMMERCE_STORE_HASH
 * - BIGCOMMERCE_ACCESS_TOKEN
 * - BIGCOMMERCE_CHANNEL_ID
 *
 * Required Access Token Scopes:
 * - store_v2_products
 */

import { strict as assert } from "assert";

function getApiOrigin() {
  return process.env.BIGCOMMERCE_API_ORIGIN || "https://api.bigcommerce.com";
}

function getStoreHash() {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  assert(storeHash, "BIGCOMMERCE_STORE_HASH missing in env");
  return storeHash;
}

function getAccessToken() {
  const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN;
  assert(accessToken, "BIGCOMMERCE_ACCESS_TOKEN missing in env");
  return accessToken;
}

function getChannelId() {
  const channelId = process.env.BIGCOMMERCE_CHANNEL_ID;
  assert(channelId, "BIGCOMMERCE_CHANNEL_ID missing in env");
  assert(parseInt(channelId, 10), "BIGCOMMERCE_CHANNEL_ID must be a number");
  return parseInt(channelId, 10);
}

function bigcommerce(path: string, options: RequestInit = {}) {
  const { headers = {}, ...rest } = options;

  const apiOrigin = getApiOrigin();
  const storeHash = getStoreHash();
  const accessToken = getAccessToken();

  return fetch(`${apiOrigin}/stores/${storeHash}${path}`, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-auth-token": accessToken,
      ...headers,
    },
    ...rest,
  });
}

async function createCategoryTree() {
  const channelId = getChannelId();

  const response = await bigcommerce("/v3/catalog/trees", {
    method: "PUT",
    body: JSON.stringify([
      {
        name: "Catalyst catalog tree",
        channels: [channelId],
      },
    ]),
  });

  return response.json() as Promise<{ data: { id: number }[] }>;
}

async function getCategoriesByTreeIds(treeIds: number[]) {
  const response = await bigcommerce(
    `/v3/catalog/trees/categories?tree_id:in=${treeIds.join(",")}`,
  );
  return response.json() as Promise<{
    data: { category_id: number; name: string; sort_order: number }[];
  }>;
}

function buildCategoriesForNewTree(
  categories: { name: string; sort_order: number }[],
  newTreeId: number,
) {
  return categories.map(({ name, sort_order }) => ({
    name,
    sort_order,
    tree_id: newTreeId,
  }));
}

async function createCategories(
  categories: { name: string; sort_order: number; tree_id: number }[],
) {
  const response = await bigcommerce("/v3/catalog/trees/categories", {
    method: "POST",
    body: JSON.stringify(categories),
  });

  return response.json() as Promise<{
    data: { category_id: number; name: string; sort_order: number }[];
  }>;
}

async function getProductCategoryAssignmentsForCategoryIds(
  categoryIds: number[],
) {
  const response = await bigcommerce(
    `/v3/catalog/products/category-assignments?category_id:in=${categoryIds.join(",")}`,
  );

  return response.json() as Promise<{
    data: { product_id: number; category_id: number }[];
  }>;
}

function buildProductCategoryAssignmentsForNewCategories(
  productCategoryAssignments: { product_id: number; category_id: number }[],
  categoriesMap: Map<number, string>,
  createdCategoriesMap: Map<string, number>,
) {
  return productCategoryAssignments.map((assign) => {
    const categoryName = categoriesMap.get(assign.category_id);

    if (!categoryName)
      throw new Error(
        `Stencil category name not found for category ID ${assign.category_id}`,
      );

    const newCategoryId = createdCategoriesMap.get(categoryName);

    if (!newCategoryId)
      throw new Error(
        `Catalyst category ID not found for category name ${categoryName}`,
      );

    return {
      product_id: assign.product_id,
      category_id: newCategoryId,
    };
  });
}

async function createProductCategoryAssignments(
  assignments: { product_id: number; category_id: number }[],
) {
  await bigcommerce("/v3/catalog/products/category-assignments", {
    method: "PUT",
    body: JSON.stringify(assignments),
  });
}

async function getProductChannelAssignments() {
  const response = await bigcommerce(
    "/v3/catalog/products/channel-assignments",
  );

  return response.json() as Promise<{
    data: { product_id: number; channel_id: number }[];
  }>;
}

function buildProductChannelAssignmentsForNewChannel(
  productChannelAssignments: { product_id: number; channel_id: number }[],
) {
  const channelId = getChannelId();

  return productChannelAssignments.map(({ product_id }) => ({
    product_id,
    channel_id: channelId,
  }));
}

async function createProductChannelAssignments(
  assignments: { product_id: number; channel_id: number }[],
) {
  await bigcommerce("/v3/catalog/products/channel-assignments", {
    method: "PUT",
    body: JSON.stringify(assignments),
  });
}

console.log("[INFO] Creating new category tree");
const { data: newTree } = await createCategoryTree();
console.log("[SUCCESS] New category tree created successfully");

console.log("[INFO] Fetching categories for tree id 1");
const { data: categories } = await getCategoriesByTreeIds([1]);
console.log("[SUCCESS] Categories fetched successfully");

console.log("[INFO] Building categories for new tree");
const categoriesForNewTree = buildCategoriesForNewTree(
  categories,
  newTree[0].id,
);
console.log("[SUCCESS] Categories built successfully");

console.log("[INFO] Creating categories for new tree");
const { data: createdCategories } =
  await createCategories(categoriesForNewTree);
console.log("[SUCCESS] Categories created successfully");

console.log("[INFO] Fetching product category assignments...");
const { data: productCategoryAssignments } =
  await getProductCategoryAssignmentsForCategoryIds(
    categories.map((cat) => cat.category_id),
  );
console.log("[SUCCESS] Product category assignments fetched successfully");

const categoriesMap = new Map(
  categories.map((cat) => [cat.category_id, cat.name]),
);

const createdCategoriesMap = new Map(
  createdCategories.map((cat) => [cat.name, cat.category_id]),
);

console.log("[INFO] Building Catalyst product category assignments...");
const catalystProductCategoryAssignments =
  buildProductCategoryAssignmentsForNewCategories(
    productCategoryAssignments,
    categoriesMap,
    createdCategoriesMap,
  );
console.log("[SUCCESS] Built Catalyst product category assignments");

console.log("[INFO] Creating Catalyst product category assignments...");
await createProductCategoryAssignments(catalystProductCategoryAssignments);
console.log("[SUCCESS] Created Catalyst product category assignments");

console.log("[INFO] Fetching product channel assignments...");
const { data: productChannelAssignments } =
  await getProductChannelAssignments();
console.log("[SUCCESS] Product channel assignments fetched successfully");

console.log("[INFO] Building Catalyst product channel assignments...");
const catalystProductChannelAssignments =
  buildProductChannelAssignmentsForNewChannel(productChannelAssignments);
console.log("[SUCCESS] Built Catalyst product channel assignments");

console.log("[INFO] Creating Catalyst product channel assignments...");
await createProductChannelAssignments(catalystProductChannelAssignments);
console.log("[SUCCESS] Created Catalyst product channel assignments");
