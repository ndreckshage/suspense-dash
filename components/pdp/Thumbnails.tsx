export function Thumbnails({ thumbnails }: { thumbnails: string[] }) {
  return (
    <div className="px-6 py-2 flex gap-2">
      {thumbnails.map((url, i) => (
        <div
          key={i}
          className={`w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer ${
            i === 0 ? "border-blue-500" : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          <img
            src={url}
            alt={`Thumbnail ${i + 1}`}
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}
