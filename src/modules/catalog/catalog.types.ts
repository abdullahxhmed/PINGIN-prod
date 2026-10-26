import { ComponentType, ProductType } from "@prisma/client";

export interface CreateProductInput {
  sku: string;
  name: string;
  slug: string;
  description?: string;
  type?: ProductType;
  basePrice: number;
  currency?: string;
  weightGrams?: number;
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
}

export interface CreateVariantInput {
  productId: string;
  sku: string;
  name: string;
  price: number;
  components: Array<{
    componentType: ComponentType;
    name: string;
    quantity: number;
    plusDurationMonths?: number;
    inventorySku?: string;
  }>;
}
