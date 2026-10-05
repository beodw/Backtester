
"use client";

import { useEffect, useState } from "react";
import { ChartContainer } from "@/components/algo-insights/chart-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileBarChart } from "lucide-react";


export default function AlgoInsightsPage() {
    const [activeTab, setActiveTab] = useState<'backtester' | 'journal'>('backtester');

    useEffect(() => {
        const requestedTab = new URLSearchParams(window.location.search).get('tab');
        if (requestedTab === 'journal') setActiveTab('journal');
    }, []);

    const handleTabChange = (value: string) => {
        if (value !== 'backtester' && value !== 'journal') return;
        setActiveTab(value);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', value);
        window.history.replaceState({}, '', url);
    };

    return (
        <div className="flex flex-col h-screen bg-background text-foreground font-body">
            <header className="flex items-center justify-between p-4 border-b border-border shadow-md">
                <div className="flex items-center gap-4">
                    <FileBarChart className="w-8 h-8 text-foreground" />
                    <h1 className="text-2xl font-bold font-headline text-foreground">
                        Algo Insights
                    </h1>
                </div>
            </header>
            <main className="flex-1 relative overflow-hidden">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full h-full flex flex-col">
                    <div className="flex justify-center pt-2">
                        <TabsList>
                            <TabsTrigger value="backtester">Backtester</TabsTrigger>
                            <TabsTrigger value="journal">Journal Reconstruction</TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="backtester" className="w-full flex-1">
                        <ChartContainer tab="backtester" />
                    </TabsContent>
                    <TabsContent value="journal" className="w-full flex-1">
                        <ChartContainer tab="journal" />
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    )
}
