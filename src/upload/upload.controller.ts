import { Controller, Post, Req, Res, Get, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { UploadService } from './upload.service';
import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream';
import {
  UploadPartCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'your-region' });

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Get()
  async upload(@Req() req: Request): Promise<number> {
    return 1;
  }

  @Post('multipart/disk')
  async uploadMPS(@Req() req: Request, @Res() res: Response): Promise<any> {
    const bb = Busboy({ headers: req.headers });
    pipeline(req, bb, (err) => {
      if (err) {
        console.error('Error uploading file:', err);
        res.status(500).end();
      }
    });

    bb.on('file', (name, file, info) => {
      const { filename, encoding, mimeType } = info;
      const writeStream = createWriteStream(
        `uploads/${mimeType.split('/')[1]}/${filename}`,
      );
      console.log(
        `File [${name}]: filename: %j, encoding: %j, mimeType: %j`,
        filename,
        encoding,
        mimeType,
        info,
      );

      pipeline(file, writeStream, (err) => {
        if (err) {
          console.error('Error uploading file:', err);
          res.status(500).end();
        }
      });

      file.on('close', () => {
        console.log(`File [${name}] done`);
      });
    });
    bb.on('field', (name, val, info) => {
      console.log(`Field [${name}]: value: %j`, val, info);
    });
    bb.on('close', () => {
      console.log('Done parsing form!');
      res.writeHead(303, { Connection: 'close', Location: '/' });
      return res.end();
    });
  }
  @Post('multipart/s3')
  async uploadS3(@Req() req: Request, @Res() res: Response): Promise<any> {
    const bb = Busboy({ headers: req.headers });

    try {
      bb.on('file', async (fieldname, file, filename, encoding, mimetype) => {
        const parts = [];

        const params = {
          Bucket: `files/${filename}`,
          Key: 'your-object-key',
          ContentType: mimetype,
        };
        const createMultipartUploadCommand = new CreateMultipartUploadCommand(
          params,
        );
        const { UploadId: uploadId } = await s3.send(
          createMultipartUploadCommand,
        );

        file
          .on('data', async (part: ReadableStream) => {
            const partParams = {
              Bucket: 'your-bucket-name',
              Key: 'your-object-key',
              UploadId: uploadId,
              PartNumber: parts.length + 1,
              Body: part,
            };
            const uploadPartCommand = new UploadPartCommand(partParams);
            const { ETag } = await s3.send(uploadPartCommand);
            parts.push({ ETag, PartNumber: partParams.PartNumber });
          })
          .on('close', async () => {
            const completeParams = {
              Bucket: 'your-bucket-name',
              Key: 'your-object-key',
              UploadId: uploadId,
              MultipartUpload: {
                Parts: parts,
              },
            };
            const completeMultipartUploadCommand =
              new CompleteMultipartUploadCommand(completeParams);
            await s3.send(completeMultipartUploadCommand);
            res.send('File uploaded successfully');
          });
      });

      bb.on('finish', async () => {
        console.log('Parsing Done');
      });

      pipeline(req, bb, (err) => console.log(err));
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to upload file');
    }
  }
}
