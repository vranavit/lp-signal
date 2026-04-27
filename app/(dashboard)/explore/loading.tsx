import { Skeleton } from "@/components/ui/skeleton";

export default function ExploreLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-2 h-3 w-[420px]" />
      </div>
      <Skeleton className="h-[88px] w-full" />
      <div className="grid grid-cols-4 gap-2">
        <Skeleton className="h-[60px]" />
        <Skeleton className="h-[60px]" />
        <Skeleton className="h-[60px]" />
        <Skeleton className="h-[60px]" />
      </div>
      <Skeleton className="h-[600px] w-full" />
    </div>
  );
}
