import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ManagementAuthGuard } from '../../../auth/presentation/http/management-auth.guard';
import { FunctionsApplicationService } from '../../application/functions.application-service';

const functionSpecSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['image'],
  properties: {
    image: { type: 'string' },
    description: { type: 'string', maxLength: 200 },
    port: { type: 'integer', minimum: 1, maximum: 65535, default: 8080 },
    timeoutSeconds: {
      type: 'integer',
      minimum: 1,
      maximum: 600,
      default: 30,
    },
    visibility: {
      type: 'string',
      enum: ['cluster-local', 'external'],
      default: 'cluster-local',
    },
    env: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    configMapRefs: { type: 'array', items: { type: 'string' } },
    secretRefs: { type: 'array', items: { type: 'string' } },
    resources: { type: 'object' },
    scaling: { type: 'object' },
  },
};

@ApiTags('functions')
@ApiBearerAuth()
@Controller('v1/functions')
@UseGuards(ManagementAuthGuard, ThrottlerGuard)
export class FunctionsController {
  constructor(private readonly functionsService: FunctionsApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'List managed functions' })
  list() {
    return this.functionsService.list();
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get a managed function' })
  get(@Param('name') name: string) {
    return this.functionsService.get(name);
  }

  @Put(':name')
  @ApiOperation({ summary: 'Create or update a function' })
  @ApiBody({ schema: functionSpecSchema })
  apply(@Param('name') name: string, @Body() body: unknown) {
    return this.functionsService.apply(name, body);
  }

  @Post(':name/render')
  @ApiOperation({ summary: 'Render a Knative Service without applying it' })
  @ApiBody({ schema: functionSpecSchema })
  render(@Param('name') name: string, @Body() body: unknown) {
    return this.functionsService.render(name, body);
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a managed function' })
  delete(@Param('name') name: string) {
    return this.functionsService.delete(name);
  }
}
