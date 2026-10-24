import { Bar, BarChart, LabelList } from "recharts";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";

type Month = {
  month: string;
  partial: boolean;
  queries: number;
  capped: boolean;
  clicks: number;
  impressions: number;
};

const chartConfig = {
  queries: { label: "Queries", color: "#3b5ba5" },
} satisfies ChartConfig;

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

/** How many different queries Google showed the page for, month by month. */
export function GscPageQueryChart({ months }: { months: Month[] }) {
  if (months.every((month) => month.queries === 0))
    return (
      <p className="text-sm text-muted-foreground">
        No queries in the last 12 months.
      </p>
    );
  return (
    <div className="space-y-1">
      <div className="h-64 w-full min-w-0">
        <ChartContainer config={chartConfig} className="h-full">
          <BarChart
            data={months}
            margin={{ top: 20, right: 0, bottom: 0, left: 0 }}
          >
            <ChartGrid />
            <ChartXAxis dataKey="month" tickFormatter={monthLabel} />
            <ChartYAxis />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label: unknown) => {
                    const entry = months.find((month) => month.month === label);
                    if (!entry) return "";
                    return `${monthLabel(entry.month)}${entry.partial ? " (so far)" : ""} · ${entry.clicks.toLocaleString("en-US")} clicks · ${entry.impressions.toLocaleString("en-US")} impressions`;
                  }}
                  valueFormatter={(value) => {
                    const count = Number(value);
                    return `${count.toLocaleString("en-US")}${count >= 25_000 ? "+" : ""}`;
                  }}
                />
              }
            />
            <Bar
              dataKey="queries"
              fill="var(--color-queries)"
              radius={[3, 3, 0, 0]}
              maxBarSize={40}
            >
              <LabelList
                dataKey="queries"
                position="top"
                className="fill-foreground text-[10px]"
                formatter={(value: unknown) =>
                  Number(value) > 0 ? Number(value).toLocaleString("en-US") : ""
                }
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Google leaves out rare and private searches, so real counts are a little
        higher. The last bar is this month so far.
      </p>
    </div>
  );
}
