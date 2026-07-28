import { Module } from '@nestjs/common';
import { CHESS_ENGINE } from './application/ports/chess-engine.js';
import { ChessJsEngine } from './infrastructure/chessjs.engine.js';

@Module({
  exports: [CHESS_ENGINE],
  providers: [{ provide: CHESS_ENGINE, useClass: ChessJsEngine }],
})
export class ChessModule {}
