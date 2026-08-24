/** Shapes shared by the public site and the admin CMS. */

export type StockStatus = "In Stock" | "Low Stock" | "Draft" | "Made to Order";

export type Product = {
  slug: string;
  name: string;
  sku: string;
  category: "Lighting" | "Furniture" | "Home Decor" | "Basketry";
  material: string;
  origin: string;
  moq: string;
  status: StockStatus;
  stock: string;
};

export type Artisan = {
  slug: string;
  initial: string;
  name: string;
  craft: string;
  place: string;
  since: string;
  capacity: string;
  note: string;
  status: "Aktif" | "Verifikasi" | "Kapasitas penuh";
};

export type Article = {
  slug: string;
  title: string;
  category: "Craft Journal" | "Process" | "Material" | "Artisan Story";
  date: string;
  author: string;
  excerpt: string;
  tags: string[];
  paragraphs: string[];
  status: "Published" | "Draft" | "Scheduled";
};

export type Comment = {
  initial: string;
  name: string;
  when: string;
  text: string;
};

export type Inquiry = {
  name: string;
  company: string;
  subject: string;
  preview: string;
  body: string;
  when: string;
  status: "Baru" | "Diproses" | "Selesai";
  volume: string;
  target: string;
  port: string;
  email: string;
};

export type TagTone = "accent" | "accent-2" | "neutral" | "outline";
