import { AdminScreen } from "@/components/admin/PageHeading";
import { ProductTable } from "@/components/admin/ProductTable";
import { PRODUCTS } from "@/lib/data";

export default function AdminProductsPage() {
  return (
    <AdminScreen>
      <ProductTable initial={PRODUCTS} />
    </AdminScreen>
  );
}
