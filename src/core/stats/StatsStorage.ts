/**
 * Stats storage - persists usage records to JSON files
 */

import fs from 'fs/promises';
import path from 'path';
import type { IStatsStorage, UsageRecord } from '../../types/stats.js';
import { getUserStatsDir } from '../config/PathManager.js';

export class StatsStorage implements IStatsStorage {
  private readonly statsDir: string;

  constructor(baseDir?: string, userId?: string) {
    if (userId) {
      this.statsDir = getUserStatsDir(userId);
    } else {
      this.statsDir = baseDir || path.join(process.cwd(), '.xuanji', 'stats');
    }
  }

  async saveRecord(record: UsageRecord): Promise<void> {
    await this.ensureStatsDir();
    
    const date = new Date(record.timestamp);
    const monthKey = this.getMonthKey(date);
    const filePath = this.getMonthFilePath(monthKey);

    let records: UsageRecord[] = [];
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      records = JSON.parse(content);
    } catch (error) {
      // File doesn't exist or invalid JSON, start fresh
    }

    records.push(record);
    await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8');
  }

  async getDailyRecords(date: Date): Promise<UsageRecord[]> {
    const monthKey = this.getMonthKey(date);
    const filePath = this.getMonthFilePath(monthKey);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const records: UsageRecord[] = JSON.parse(content);
      
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      return records.filter(r => 
        r.timestamp >= dayStart.getTime() && r.timestamp <= dayEnd.getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async getRangeRecords(startDate: Date, endDate: Date): Promise<UsageRecord[]> {
    const months = this.getMonthsInRange(startDate, endDate);
    const allRecords: UsageRecord[] = [];

    for (const monthKey of months) {
      const filePath = this.getMonthFilePath(monthKey);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const records: UsageRecord[] = JSON.parse(content);
        allRecords.push(...records);
      } catch (error) {
        // Month file doesn't exist, skip
      }
    }

    const startTime = startDate.getTime();
    const endTime = endDate.getTime();

    return allRecords.filter(r => r.timestamp >= startTime && r.timestamp <= endTime);
  }

  private async ensureStatsDir(): Promise<void> {
    try {
      await fs.mkdir(this.statsDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  private getMonthKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private getMonthFilePath(monthKey: string): string {
    return path.join(this.statsDir, `${monthKey}.json`);
  }

  private getMonthsInRange(startDate: Date, endDate: Date): string[] {
    const months: string[] = [];
    const current = new Date(startDate);
    current.setDate(1);

    while (current <= endDate) {
      months.push(this.getMonthKey(current));
      current.setMonth(current.getMonth() + 1);
    }

    return months;
  }
}
