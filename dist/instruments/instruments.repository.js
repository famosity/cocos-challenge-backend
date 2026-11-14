var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
let InstrumentsRepository = class InstrumentsRepository {
    database;
    constructor(database) {
        this.database = database;
    }
    search(term) {
        const pattern = escapeLike(term);
        return this.database.query(`SELECT id, ticker, name, type
       FROM instruments
       WHERE ticker ILIKE '%' || $1 || '%' ESCAPE '\\'
          OR name ILIKE '%' || $1 || '%' ESCAPE '\\'
       ORDER BY CASE WHEN lower(ticker) = lower($2) THEN 0 ELSE 1 END,
                ticker ASC,
                id ASC`, [pattern, term]);
    }
};
InstrumentsRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], InstrumentsRepository);
export { InstrumentsRepository };
function escapeLike(term) {
    return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
//# sourceMappingURL=instruments.repository.js.map