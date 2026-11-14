var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service.js';
let InstrumentsController = class InstrumentsController {
    instruments;
    constructor(instruments) {
        this.instruments = instruments;
    }
    search(query) {
        const term = query?.trim() ?? '';
        if (term.length === 0) {
            throw new BadRequestException(['query must not be empty']);
        }
        return this.instruments.search(term);
    }
};
__decorate([
    Get(),
    __param(0, Query('query')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], InstrumentsController.prototype, "search", null);
InstrumentsController = __decorate([
    Controller('instruments'),
    __metadata("design:paramtypes", [InstrumentsService])
], InstrumentsController);
export { InstrumentsController };
//# sourceMappingURL=instruments.controller.js.map