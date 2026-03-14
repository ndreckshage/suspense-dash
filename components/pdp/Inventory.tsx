interface InventoryData {
  status: string;
  quantity: number;
  warehouse: string;
}

export function Inventory({ data }: { data: InventoryData }) {
  const isInStock = data.quantity > 0;

  return (
    <div className="px-6 md:px-0 py-1">
      {isInStock ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-green-400">{data.status}</span>
          <span className="text-xs text-zinc-600">
            ({data.quantity} available)
          </span>
        </div>
      ) : (
        <span className="text-sm text-red-400">Out of Stock</span>
      )}
    </div>
  );
}
