import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFavoriteInfo, IAddMemoryInfo } from './shared';

interface IFavoriteItem {
    name: string;
    expression: string;
    size: string;
}

export class FavoritesManager {
    private dbPath: string;
    private favorites: IFavoriteItem[] = [];

    constructor(private context: vscode.ExtensionContext) {
        const storageUri = context.storageUri || context.globalStorageUri;
        if (!fs.existsSync(storageUri.fsPath)) {
            fs.mkdirSync(storageUri.fsPath, { recursive: true });
        }
        this.dbPath = path.join(storageUri.fsPath, 'memview_favorites.json');
    }

    public async init() {
        this.load();
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                this.favorites = JSON.parse(data);
            } catch (e) {
                console.error("Failed to load favorites", e);
                this.favorites = [];
            }
        }
    }

    private save() {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(this.favorites, null, 2));
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save favorites: ${e}`);
        }
    }

    public addFavorite(name: string, info: IAddMemoryInfo) {
        const index = this.favorites.findIndex(f => f.name === name);
        if (index >= 0) {
            this.favorites[index] = { name, expression: info.expr, size: info.size };
        } else {
            this.favorites.push({ name, expression: info.expr, size: info.size });
        }
        this.save();
    }

    public getFavorites(criteria?: string): IFavoriteInfo[] {
        let res = this.favorites;
        if (criteria) {
            const lower = criteria.toLowerCase();
            res = res.filter(f => f.name.toLowerCase().includes(lower));
        }
        return res.map(f => ({ name: f.name }));
    }
    
    public getFavorite(name: string): IAddMemoryInfo | undefined {
        const item = this.favorites.find(f => f.name === name);
        if (item) {
            return { expr: item.expression, size: item.size };
        }
        return undefined;
    }

    public deleteFavorite(name: string) {
        this.favorites = this.favorites.filter(f => f.name !== name);
        this.save();
    }

    public async importFavorites() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Import',
            filters: {
                'JSON Files': ['json'],
                'All Files': ['*']
            }
        };
       
        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            try {
                const data = fs.readFileSync(fileUri[0].fsPath, 'utf8');
                const imported = JSON.parse(data);
                if (Array.isArray(imported)) {
                    imported.forEach((item: IFavoriteItem) => {
                        if (item.name && item.expression && item.size) {
                            this.addFavorite(item.name, { expr: item.expression, size: item.size });
                        }
                    });
                    vscode.window.showInformationMessage('Favorites imported successfully.');
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to import favorites: ${e}`);
            }
        }
    }

    public async exportFavorites() {
        const options: vscode.SaveDialogOptions = {
            saveLabel: 'Export',
            filters: {
                'JSON Files': ['json'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            try {
                fs.copyFileSync(this.dbPath, fileUri.fsPath);
                vscode.window.showInformationMessage('Favorites exported successfully.');
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to export favorites: ${e}`);
            }
        }
    }
}

