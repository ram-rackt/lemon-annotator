import { Suspense } from "react";

import { ReviewSkeleton, ReviewView } from "@/components/review/review-view";

export const metadata = { title: "Coach review" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <ReviewView />
    </Suspense>
  );
}
