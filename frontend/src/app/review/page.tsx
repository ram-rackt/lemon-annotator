import { Suspense } from "react";

import { ReviewOverview, ReviewOverviewSkeleton } from "@/components/review/review-overview";

export const metadata = { title: "Coach review" };

export default function ReviewOverviewPage() {
  return (
    <Suspense fallback={<ReviewOverviewSkeleton />}>
      <ReviewOverview />
    </Suspense>
  );
}
