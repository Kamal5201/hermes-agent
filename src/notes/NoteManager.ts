/**
 * Note Manager - 智能笔记管理
 */

import { EventEmitter } from 'events';
import log from 'electron-log/main.js';

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  color?: string;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
}

export class NoteManager extends EventEmitter {
  private notes: Map<string, Note> = new Map();
  private folders: Map<string, NoteFolder> = new Map();
  private searchIndex: Map<string, string[]> = new Map();
  
  constructor() {
    super();
    this.initDefaultFolder();
  }
  
  private initDefaultFolder(): void {
    this.createFolder('Personal');
    this.createFolder('Work');
    this.createFolder('Ideas');
  }
  
  public createNote(title: string, content: string, tags: string[] = []): Note {
    const id = `note-${Date.now()}`;
    const now = Date.now();
    
    const note: Note = {
      id, title, content, tags, createdAt: now, updatedAt: now, pinned: false,
    };
    
    this.notes.set(id, note);
    this.indexNote(note);
    this.emit('noteCreated', note);
    
    return note;
  }
  
  public updateNote(id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'pinned' | 'color'>>): Note | null {
    const note = this.notes.get(id);
    if (!note) return null;
    
    Object.assign(note, updates, { updatedAt: Date.now() });
    this.indexNote(note);
    this.emit('noteUpdated', note);
    
    return note;
  }
  
  public deleteNote(id: string): boolean {
    const deleted = this.notes.delete(id);
    if (deleted) {
      this.searchIndex.delete(id);
      this.emit('noteDeleted', id);
    }
    return deleted;
  }
  
  public getNote(id: string): Note | undefined {
    return this.notes.get(id);
  }
  
  public getAllNotes(): Note[] {
    return Array.from(this.notes.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  
  public getPinnedNotes(): Note[] {
    return this.getAllNotes().filter(n => n.pinned);
  }
  
  public searchNotes(query: string): Note[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.notes.values()).filter(note => {
      const titleMatch = note.title.toLowerCase().includes(lowerQuery);
      const contentMatch = note.content.toLowerCase().includes(lowerQuery);
      const tagMatch = note.tags.some(t => t.toLowerCase().includes(lowerQuery));
      return titleMatch || contentMatch || tagMatch;
    });
  }
  
  public getNotesByTag(tag: string): Note[] {
    return this.getAllNotes().filter(n => n.tags.includes(tag));
  }
  
  public getAllTags(): string[] {
    const tags = new Set<string>();
    for (const note of this.notes.values()) {
      note.tags.forEach(t => tags.add(t));
    }
    return Array.from(tags).sort();
  }
  
  private indexNote(note: Note): void {
    const words = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase().split(/\s+/);
    this.searchIndex.set(note.id, words);
  }
  
  // Folder methods
  public createFolder(name: string, parentId?: string, color?: string): NoteFolder {
    const folder: NoteFolder = { id: `folder-${Date.now()}`, name, parentId, color };
    this.folders.set(folder.id, folder);
    return folder;
  }
  
  public getFolders(): NoteFolder[] {
    return Array.from(this.folders.values());
  }
  
  public deleteFolder(id: string): boolean {
    return this.folders.delete(id);
  }
  
  public getNotesInFolder(folderId: string): Note[] {
    // 实现文件夹过滤逻辑
    return this.getAllNotes();
  }
}

export default NoteManager;
