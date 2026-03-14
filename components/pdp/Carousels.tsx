interface CarouselData {
  title: string;
  items: {
    id: string;
    name: string;
    price: number;
    imageUrl: string;
    rating: number;
  }[];
}

export function Carousels({ data }: { data: CarouselData }) {
  return (
    <div className="px-6 py-6 border-t border-zinc-800">
      <h2 className="text-lg font-semibold text-white mb-4">{data.title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {data.items.map((item) => (
          <div
            key={item.id}
            className="flex-shrink-0 w-44 bg-zinc-800/50 rounded-lg p-3"
          >
            <div className="aspect-square bg-zinc-700 rounded mb-2 flex items-center justify-center text-zinc-500 text-xs">
              IMG
            </div>
            <div className="text-sm text-zinc-300 truncate">{item.name}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm font-medium text-white">
                ${item.price}
              </span>
              <span className="text-xs text-yellow-400">
                ★ {item.rating}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
