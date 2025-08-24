export enum DownloadStatus {
  IDLE = 'idle',
  DOWNLOADING = 'downloading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface DownloadState {
  modelId: string;
  status: DownloadStatus;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number; // bytes per second
  error?: string;
  logs: DownloadLog[];
  startTime?: Date;
  endTime?: Date;
  retryCount: number;
}

export interface DownloadLog {
  timestamp: Date;
  level: 'info' | 'warning' | 'error';
  message: string;
  details?: any;
}